// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAnon, asSuper, asUser, createDb, createUser, expectBlockedWrite, insertRecipe, visibleRows,
} from "./helpers/db";

let db: PGlite;
let alice: string;
let bob: string;
let recipe: { id: string; slug: string };

async function aliceFolder(name: string) {
  return asUser(db, alice, async (tx) =>
    (await tx.query<{ id: string; user_id: string }>(`insert into folders (name) values ($1) returning id, user_id`, [name])).rows[0],
  );
}

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db);
  bob = await createUser(db);
  recipe = await insertRecipe(db, { status: "live" });
});

describe("cookbook RLS (folders and saves)", () => {
  it("user creates and reads own folders", async () => {
    const folder = await aliceFolder("Weeknight");
    expect(folder.user_id).toBe(alice);
    const rows = await asUser(db, alice, async (tx) => (await tx.query<{ name: string }>(`select name from folders where id = $1`, [folder.id])).rows);
    expect(rows).toEqual([{ name: "Weeknight" }]);
  });

  it("other user cannot read or modify them", async () => {
    const folder = await aliceFolder("Private");
    const seen = await asUser(db, bob, async (tx) => (await tx.query(`select id from folders where id = $1`, [folder.id])).rows);
    expect(seen).toHaveLength(0);
    await expectBlockedWrite(() => asUser(db, bob, (tx) => tx.query(`update folders set name = 'pwned' where id = $1`, [folder.id])));
    await expectBlockedWrite(() => asUser(db, bob, (tx) => tx.query(`delete from folders where id = $1`, [folder.id])));
    expect(await asSuper(db, `select name from folders where id = $1`, [folder.id])).toEqual([{ name: "Private" }]);
    // cannot create a folder owned by someone else
    await expect(
      asUser(db, bob, (tx) => tx.query(`insert into folders (user_id, name) values ($1, 'planted')`, [alice])),
    ).rejects.toThrow();
  });

  it("user saves a live recipe into own folder", async () => {
    const folder = await aliceFolder("Saved");
    const save = await asUser(db, alice, async (tx) =>
      (await tx.query<{ user_id: string }>(`insert into saves (recipe_id, folder_id) values ($1, $2) returning user_id`, [recipe.id, folder.id])).rows[0],
    );
    expect(save.user_id).toBe(alice);
    const rows = await asUser(db, alice, async (tx) => (await tx.query(`select id from saves where recipe_id = $1`, [recipe.id])).rows);
    expect(rows).toHaveLength(1);
    const bobSees = await asUser(db, bob, async (tx) => (await tx.query(`select id from saves`)).rows);
    expect(bobSees).toHaveLength(0);
  });

  it("user cannot save into another user's folder", async () => {
    const folder = await aliceFolder("Not yours");
    await expect(
      asUser(db, bob, (tx) => tx.query(`insert into saves (recipe_id, folder_id) values ($1, $2)`, [recipe.id, folder.id])),
    ).rejects.toThrow();
    await expect(
      asUser(db, bob, (tx) => tx.query(`insert into saves (user_id, recipe_id) values ($1, $2)`, [alice, recipe.id])),
    ).rejects.toThrow();
    expect(await asSuper(db, `select id from saves where folder_id = $1`, [folder.id])).toHaveLength(0);
  });

  it("anon cannot read saves", async () => {
    await asSuper(db, `insert into saves (user_id, recipe_id) values ($1, $2) on conflict do nothing`, [bob, recipe.id]);
    const rows = await visibleRows(() => asAnon(db, (tx) => tx.query(`select id from saves`)));
    expect(rows).toHaveLength(0);
    const folders = await visibleRows(() => asAnon(db, (tx) => tx.query(`select id from folders`)));
    expect(folders).toHaveLength(0);
  });

  it("user cannot point a save at a draft recipe", async () => {
    const draft = await insertRecipe(db, { status: "draft" });
    const [save] = await asSuper<{ id: string }>(
      db,
      `insert into saves (user_id, recipe_id) values ($1, $2) returning id`,
      [alice, (await insertRecipe(db, { status: "live" })).id],
    );
    await expect(
      asUser(db, alice, (tx) => tx.query(`update saves set recipe_id = $2 where id = $1`, [save.id, draft.id])),
    ).rejects.toThrow();
    await expect(
      asUser(db, alice, (tx) => tx.query(`insert into saves (recipe_id) values ($1)`, [draft.id])),
    ).rejects.toThrow();
    expect(await asSuper(db, `select id from saves where recipe_id = $1`, [draft.id])).toHaveLength(0);
  });

  it("other user cannot move or take over a save", async () => {
    const folder = await aliceFolder("Hers");
    const live = await insertRecipe(db, { status: "live" });
    const [save] = await asSuper<{ id: string }>(
      db,
      `insert into saves (user_id, recipe_id, folder_id) values ($1, $2, $3) returning id`,
      [alice, live.id, folder.id],
    );
    const bobFolder = await asUser(db, bob, async (tx) =>
      (await tx.query<{ id: string }>(`insert into folders (name) values ('His') returning id`)).rows[0],
    );
    await expectBlockedWrite(() =>
      asUser(db, bob, (tx) => tx.query(`update saves set folder_id = $2 where id = $1`, [save.id, bobFolder.id])),
    );
    await expectBlockedWrite(() =>
      asUser(db, bob, (tx) => tx.query(`update saves set user_id = $2 where id = $1`, [save.id, bob])),
    );
    // the owner cannot hand it to someone else, or file it in someone else's folder
    await expect(
      asUser(db, alice, (tx) => tx.query(`update saves set user_id = $2 where id = $1`, [save.id, bob])),
    ).rejects.toThrow();
    await expect(
      asUser(db, alice, (tx) => tx.query(`update saves set folder_id = $2 where id = $1`, [save.id, bobFolder.id])),
    ).rejects.toThrow();
    expect(await asSuper(db, `select user_id, folder_id from saves where id = $1`, [save.id])).toEqual([
      { user_id: alice, folder_id: folder.id },
    ]);
  });
});
