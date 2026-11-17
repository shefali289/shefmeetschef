// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, createDb, createUser, expectBlockedWrite, insertRecipe, makeAdmin,
} from "./helpers/db";

let db: PGlite;
let user: string;
let admin: string;
let liveShef: { id: string; slug: string };
let draftShef: { id: string; slug: string };
let liveOutside: { id: string; slug: string };

beforeAll(async () => {
  db = await createDb();
  user = await createUser(db);
  admin = await createUser(db);
  await makeAdmin(db, admin);
  liveShef = await insertRecipe(db, { slug: "live-shef", status: "live", source: "shef" });
  draftShef = await insertRecipe(db, { slug: "draft-shef", status: "draft", source: "shef" });
  liveOutside = await insertRecipe(db, { slug: "reel-live-outside", status: "live", source: "outside", owner_id: user });
});

describe("recipes RLS", () => {
  it("anon sees only live shef recipes", async () => {
    const rows = await asAnon(db, async (tx) => (await tx.query<{ slug: string }>(`select slug from recipes order by slug`)).rows);
    expect(rows.map((r) => r.slug)).toEqual([liveShef.slug]);
  });

  it("anon cannot see drafts", async () => {
    const rows = await asAnon(db, async (tx) => (await tx.query(`select id from recipes where id = $1`, [draftShef.id])).rows);
    expect(rows).toHaveLength(0);
  });

  it("anon cannot see live outside recipes", async () => {
    const rows = await asAnon(db, async (tx) => (await tx.query(`select id from recipes where id = $1`, [liveOutside.id])).rows);
    expect(rows).toHaveLength(0);
  });

  it("normal user cannot insert a shef recipe", async () => {
    await expect(
      asUser(db, user, (tx) =>
        tx.query(`insert into recipes (slug, title, source, status) values ('hack', 'Hack', 'shef', 'live')`),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(db, user, (tx) => tx.query(`insert into recipes (slug, title) values ('hack-draft', 'Hack')`)),
    ).rejects.toThrow();
    expect(await asSuper(db, `select id from recipes where slug like 'hack%'`)).toHaveLength(0);
  });

  it("normal user cannot update or delete a recipe", async () => {
    await expectBlockedWrite(() =>
      asUser(db, user, (tx) => tx.query(`update recipes set title = 'pwned' where id = $1`, [liveShef.id])),
    );
    await expectBlockedWrite(() =>
      asUser(db, user, (tx) => tx.query(`update recipes set status = 'live' where id = $1`, [draftShef.id])),
    );
    await expectBlockedWrite(() => asUser(db, user, (tx) => tx.query(`delete from recipes where id = $1`, [liveShef.id])));
    const rows = await asSuper<{ title: string }>(db, `select title from recipes where id = $1`, [liveShef.id]);
    expect(rows).toEqual([{ title: liveShef.slug }]);
    const draft = await asSuper<{ status: string }>(db, `select status from recipes where id = $1`, [draftShef.id]);
    expect(draft).toEqual([{ status: "draft" }]);
  });

  it("admin sees drafts", async () => {
    const rows = await asAdmin(db, admin, async (tx) => (await tx.query(`select id from recipes where id = $1`, [draftShef.id])).rows);
    expect(rows).toHaveLength(1);
  });

  it("admin can insert, update, publish and delete", async () => {
    const id = await asAdmin(db, admin, async (tx) => {
      const res = await tx.query<{ id: string }>(
        `insert into recipes (slug, title, ingredients, steps)
         values ('admin-new', 'New', '[{"qty":1,"unit":"cup","item":"rice","note":null}]', '["Cook"]') returning id`,
      );
      return res.rows[0].id;
    });
    const fresh = await asSuper<{ status: string; source: string }>(db, `select status, source from recipes where id = $1`, [id]);
    expect(fresh).toEqual([{ status: "draft", source: "shef" }]);

    const upd = await asAdmin(db, admin, (tx) => tx.query(`update recipes set title = 'Edited' where id = $1`, [id]));
    expect(upd.affectedRows).toBe(1);

    const pub = await asAdmin(db, admin, (tx) =>
      tx.query(`update recipes set status = 'live', published_at = now() where id = $1`, [id]),
    );
    expect(pub.affectedRows).toBe(1);
    const seen = await asAnon(db, async (tx) => (await tx.query<{ title: string }>(`select title from recipes where id = $1`, [id])).rows);
    expect(seen).toEqual([{ title: "Edited" }]);

    const del = await asAdmin(db, admin, (tx) => tx.query(`delete from recipes where id = $1`, [id]));
    expect(del.affectedRows).toBe(1);
    expect(await asSuper(db, `select id from recipes where id = $1`, [id])).toHaveLength(0);
  });

  it("signed-in non-admin cannot see drafts", async () => {
    // `user` owns liveOutside, which task 2 makes visible to its owner (see outside-recipes-rls.test.ts)
    const rows = await asUser(db, user, async (tx) => (await tx.query<{ slug: string }>(`select slug from recipes where source = 'shef' order by slug`)).rows);
    expect(rows.map((r) => r.slug)).toEqual([liveShef.slug]);
    const draft = await asUser(db, user, async (tx) => (await tx.query(`select id from recipes where status = 'draft'`)).rows);
    expect(draft).toHaveLength(0);
  });
});
