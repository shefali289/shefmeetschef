// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, createDb, createUser, expectBlockedWrite, insertRecipe, makeAdmin, visibleRows,
} from "./helpers/db";

let db: PGlite;
let alice: string;
let bob: string;
let admin: string;
let live: { id: string; slug: string };
let draft: { id: string; slug: string };

async function seedRemix(owner: string) {
  const [row] = await asSuper<{ id: string }>(
    db,
    `insert into remixes (recipe_id, user_id, photo_path, changes) values ($1, $2, $3, 'less salt') returning id`,
    [live.id, owner, `${owner}/seed.jpg`],
  );
  return row.id;
}

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db);
  bob = await createUser(db);
  admin = await createUser(db);
  await makeAdmin(db, admin);
  live = await insertRecipe(db, { status: "live" });
  draft = await insertRecipe(db, { status: "draft" });
});

describe("remixes RLS", () => {
  it("user inserts own remix with default user_id", async () => {
    const row = await asUser(db, alice, async (tx) =>
      (await tx.query<{ id: string; user_id: string }>(
        `insert into remixes (recipe_id, photo_path, changes) values ($1, $2, 'extra garlic') returning id, user_id`,
        [live.id, `${alice}/garlic.jpg`],
      )).rows[0],
    );
    expect(row.user_id).toBe(alice);
    const own = await asUser(db, alice, async (tx) => (await tx.query(`select id from remixes where id = $1`, [row.id])).rows);
    expect(own).toHaveLength(1);
  });

  it("insert with someone else's user_id throws", async () => {
    await expect(
      asUser(db, bob, (tx) =>
        tx.query(`insert into remixes (recipe_id, user_id, photo_path) values ($1, $2, $3)`, [live.id, alice, `${alice}/fake.jpg`]),
      ),
    ).rejects.toThrow();
    expect(await asSuper(db, `select id from remixes where photo_path = $1`, [`${alice}/fake.jpg`])).toHaveLength(0);
  });

  it("insert against a draft recipe throws", async () => {
    await expect(
      asUser(db, alice, (tx) =>
        tx.query(`insert into remixes (recipe_id, photo_path) values ($1, $2)`, [draft.id, `${alice}/draft.jpg`]),
      ),
    ).rejects.toThrow();
    expect(await asSuper(db, `select id from remixes where recipe_id = $1`, [draft.id])).toHaveLength(0);
  });

  it("photo_path must start with the owner's uid folder", async () => {
    await expect(
      asUser(db, alice, (tx) => tx.query(`insert into remixes (recipe_id, photo_path) values ($1, $2)`, [live.id, `${bob}/x.jpg`])),
    ).rejects.toThrow();
    await expect(
      asUser(db, alice, (tx) => tx.query(`insert into remixes (recipe_id, photo_path) values ($1, 'x.jpg')`, [live.id])),
    ).rejects.toThrow();
    const id = await seedRemix(alice);
    await expect(
      asUser(db, alice, (tx) => tx.query(`update remixes set photo_path = $2 where id = $1`, [id, `${bob}/x.jpg`])),
    ).rejects.toThrow();
    expect(await asSuper(db, `select photo_path from remixes where id = $1`, [id])).toEqual([{ photo_path: `${alice}/seed.jpg` }]);
  });

  it("user cannot point a remix at a draft recipe", async () => {
    const id = await seedRemix(alice);
    await expect(
      asUser(db, alice, (tx) => tx.query(`update remixes set recipe_id = $2 where id = $1`, [id, draft.id])),
    ).rejects.toThrow();
    expect(await asSuper(db, `select recipe_id from remixes where id = $1`, [id])).toEqual([{ recipe_id: live.id }]);
  });

  it("other user cannot select, update or delete a remix", async () => {
    const id = await seedRemix(alice);
    const seen = await asUser(db, bob, async (tx) => (await tx.query(`select id from remixes where id = $1`, [id])).rows);
    expect(seen).toHaveLength(0);
    await expectBlockedWrite(() => asUser(db, bob, (tx) => tx.query(`update remixes set changes = 'pwned' where id = $1`, [id])));
    await expectBlockedWrite(() => asUser(db, bob, (tx) => tx.query(`update remixes set user_id = $2 where id = $1`, [id, bob])));
    await expectBlockedWrite(() => asUser(db, bob, (tx) => tx.query(`delete from remixes where id = $1`, [id])));
    expect(await asSuper(db, `select user_id, changes from remixes where id = $1`, [id])).toEqual([
      { user_id: alice, changes: "less salt" },
    ]);
  });

  it("admin can select all remixes", async () => {
    const a = await seedRemix(alice);
    const b = await seedRemix(bob);
    const rows = await asAdmin(db, admin, async (tx) => (await tx.query<{ id: string }>(`select id from remixes`)).rows);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
  });

  it("anon sees no remixes", async () => {
    await seedRemix(alice);
    const rows = await visibleRows(() => asAnon(db, (tx) => tx.query(`select id from remixes`)));
    expect(rows).toHaveLength(0);
  });
});
