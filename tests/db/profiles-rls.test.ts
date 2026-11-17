// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, createDb, createUser, expectBlockedWrite, makeAdmin, visibleRows,
} from "./helpers/db";

let db: PGlite;
let alice: string;
let bob: string;
let admin: string;

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db, { email: "alice@example.com" });
  bob = await createUser(db, { email: "bob@example.com" });
  admin = await createUser(db, { email: "admin@example.com" });
  await makeAdmin(db, admin);
});

describe("profiles RLS", () => {
  it("sign-up trigger creates a profile", async () => {
    const id = await createUser(db, { email: "new@example.com", meta: { full_name: "New Cook" } });
    const rows = await asSuper<{ id: string; is_admin: boolean; plan: string; diet_prefs: string[] }>(
      db,
      `select id, is_admin, plan::text as plan, diet_prefs from profiles where id = $1`,
      [id],
    );
    expect(rows).toEqual([{ id, is_admin: false, plan: "free", diet_prefs: [] }]);
  });

  it("user reads and updates own name, avatar and diet_prefs", async () => {
    const own = await asUser(db, alice, async (tx) => (await tx.query(`select id from profiles where id = $1`, [alice])).rows);
    expect(own).toHaveLength(1);
    const res = await asUser(db, alice, (tx) =>
      tx.query(`update profiles set name = 'Alice', avatar_url = 'https://x.test/a.png', diet_prefs = '{veg}' where id = $1`, [alice]),
    );
    expect(res.affectedRows).toBe(1);
    const rows = await asSuper(db, `select name, avatar_url, diet_prefs from profiles where id = $1`, [alice]);
    expect(rows).toEqual([{ name: "Alice", avatar_url: "https://x.test/a.png", diet_prefs: ["veg"] }]);
  });

  it("user cannot read another user's profile", async () => {
    const rows = await asUser(db, alice, async (tx) => (await tx.query(`select id from profiles where id = $1`, [bob])).rows);
    expect(rows).toHaveLength(0);
    const all = await asUser(db, alice, async (tx) => (await tx.query<{ id: string }>(`select id from profiles`)).rows);
    expect(all.map((r) => r.id)).toEqual([alice]);
    const upd = await asUser(db, alice, (tx) => tx.query(`update profiles set name = 'pwned' where id = $1`, [bob]));
    expect(upd.affectedRows).toBe(0);
  });

  it("user cannot set is_admin on self", async () => {
    await expect(
      asUser(db, alice, (tx) => tx.query(`update profiles set is_admin = true where id = $1`, [alice])),
    ).rejects.toThrow();
    expect(await asSuper(db, `select is_admin from profiles where id = $1`, [alice])).toEqual([{ is_admin: false }]);
  });

  it("user cannot change own plan", async () => {
    await expect(
      asUser(db, alice, (tx) => tx.query(`update profiles set plan = 'plus' where id = $1`, [alice])),
    ).rejects.toThrow();
    expect(await asSuper(db, `select plan::text as plan from profiles where id = $1`, [alice])).toEqual([{ plan: "free" }]);
    await expect(
      asUser(db, alice, (tx) =>
        tx.query(`insert into profiles (id, is_admin, plan) values (gen_random_uuid(), true, 'plus')`),
      ),
    ).rejects.toThrow();
  });

  it("admin can read all profiles", async () => {
    const rows = await asAdmin(db, admin, async (tx) => (await tx.query<{ id: string }>(`select id from profiles`)).rows);
    const ids = rows.map((r) => r.id);
    for (const id of [alice, bob, admin]) expect(ids).toContain(id);
  });

  it("avatar_url must be https", async () => {
    await expect(
      asUser(db, alice, (tx) => tx.query(`update profiles set avatar_url = 'javascript:alert(1)' where id = $1`, [alice])),
    ).rejects.toThrow();
    await expect(
      asUser(db, alice, (tx) => tx.query(`update profiles set avatar_url = 'http://x.test/a.png' where id = $1`, [alice])),
    ).rejects.toThrow();
    const ok = await asUser(db, alice, (tx) => tx.query(`update profiles set avatar_url = 'https://x.test/b.png' where id = $1`, [alice]));
    expect(ok.affectedRows).toBe(1);
  });

  it("diet_prefs over 20 entries throws", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `pref${i}`);
    await expect(
      asUser(db, alice, (tx) => tx.query(`update profiles set diet_prefs = $2 where id = $1`, [alice, many])),
    ).rejects.toThrow();
    const twenty = many.slice(0, 20);
    const ok = await asUser(db, alice, (tx) => tx.query(`update profiles set diet_prefs = $2 where id = $1`, [alice, twenty]));
    expect(ok.affectedRows).toBe(1);
  });

  it("sign-up with a non-https avatar stores null", async () => {
    const bad = await createUser(db, { meta: { full_name: "Eve", avatar_url: "javascript:alert(1)" } });
    const good = await createUser(db, { meta: { full_name: "Gia", avatar_url: "https://x.test/g.png" } });
    expect(await asSuper(db, `select avatar_url from profiles where id = $1`, [bad])).toEqual([{ avatar_url: null }]);
    expect(await asSuper(db, `select avatar_url from profiles where id = $1`, [good])).toEqual([{ avatar_url: "https://x.test/g.png" }]);
  });

  it("guard trigger blocks is_admin and plan even with a column grant", async () => {
    await db.exec(`grant update (plan, is_admin) on public.profiles to authenticated`);
    try {
      await expect(
        asUser(db, bob, (tx) => tx.query(`update profiles set plan = 'plus' where id = $1`, [bob])),
      ).rejects.toThrow(/not allowed to change is_admin or plan/);
      await expect(
        asUser(db, bob, (tx) => tx.query(`update profiles set is_admin = true where id = $1`, [bob])),
      ).rejects.toThrow(/not allowed to change is_admin or plan/);
    } finally {
      await db.exec(`revoke update (plan, is_admin) on public.profiles from authenticated`);
    }
    expect(await asSuper(db, `select is_admin, plan::text as plan from profiles where id = $1`, [bob])).toEqual([
      { is_admin: false, plan: "free" },
    ]);
  });

  it("anon cannot read profiles", async () => {
    const rows = await visibleRows(() => asAnon(db, (tx) => tx.query(`select id from profiles`)));
    expect(rows).toHaveLength(0);
  });

  it("user cannot delete own profile", async () => {
    await expectBlockedWrite(() => asUser(db, bob, (tx) => tx.query(`delete from profiles where id = $1`, [bob])));
    expect(await asSuper(db, `select id from profiles where id = $1`, [bob])).toEqual([{ id: bob }]);
  });
});
