// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyMigrationsFrom, asAdmin, asSuper, asUser, createDb, createUser, expectBlockedWrite, insertRecipe, makeAdmin,
  pgErrorOf, type Tx,
} from "./helpers/db";

/*
 * Slice A cookbook contract (task 2), migration 20261118000004_cookbook_limits.sql:
 *   duplicate saves are merged (oldest kept), then unique (user_id, recipe_id): one save per recipe.
 *   saves.folder_id references folders on delete set null (deleting a folder keeps its saves, unfiled).
 *   before insert trigger (security definer, per-user advisory lock) raises 'saves_limit_reached'
 *   with a custom SQLSTATE when the user already has saves_limit(uid) saves of non-outside recipes.
 *   saves_limit(uid uuid) returns int, 30 for everyone today.
 */

const LIMIT_MIGRATION = "20261118000004";
const LIMIT = 30;

let db: PGlite;
let recipes: { id: string; slug: string }[];

const save = (tx: Tx, recipeId: string, folderId: string | null = null) =>
  tx.query<{ id: string }>(`insert into saves (recipe_id, folder_id) values ($1, $2) returning id`, [recipeId, folderId]);

const folder = (tx: Tx, name: string) =>
  tx.query<{ id: string }>(`insert into folders (name) values ($1) returning id`, [name]).then((r) => r.rows[0].id);

/** Saves the first n shared shef recipes for the user, one transaction each (like real requests). */
async function saveMany(user: string, n: number, folderId: string | null = null) {
  for (let i = 0; i < n; i++) await asUser(db, user, (tx) => save(tx, recipes[i].id, folderId));
}

function expectSavesLimit(err: { code: string; message: string }) {
  expect(err.message).toMatch(/saves_limit_reached/);
  expect(err.code).toMatch(/^[0-9A-Z]{5}$/);
  expect(err.code).not.toBe("P0001");
  expect(err.code).not.toBe("42501");
}

const countSaves = async (user: string) =>
  (await asSuper<{ n: number }>(db, `select count(*)::int as n from saves where user_id = $1`, [user]))[0].n;

beforeAll(async () => {
  db = await createDb();
  recipes = [];
  for (let i = 0; i < LIMIT + 2; i++) recipes.push(await insertRecipe(db, { slug: `shef-${i}`, status: "live" }));
});

describe("cookbook limits (saves)", () => {
  it("user saves 30 recipes and the 31st raises saves_limit_reached", async () => {
    const u = await createUser(db);
    const f = await asUser(db, u, (tx) => folder(tx, "Curries"));
    await saveMany(u, 10, f);
    for (let i = 10; i < LIMIT; i++) await asUser(db, u, (tx) => save(tx, recipes[i].id));
    expect(await countSaves(u)).toBe(LIMIT);
    expectSavesLimit(await pgErrorOf(() => asUser(db, u, (tx) => save(tx, recipes[LIMIT].id))));
    // filing it in a folder does not get round the limit either
    expectSavesLimit(await pgErrorOf(() => asUser(db, u, (tx) => save(tx, recipes[LIMIT].id, f))));
    expect(await countSaves(u)).toBe(LIMIT);
    // the limit is per user
    const other = await createUser(db);
    await asUser(db, other, (tx) => save(tx, recipes[LIMIT].id));
    expect(await countSaves(other)).toBe(1);
  });

  it("unsaving frees a slot", async () => {
    const u = await createUser(db);
    await saveMany(u, LIMIT);
    expectSavesLimit(await pgErrorOf(() => asUser(db, u, (tx) => save(tx, recipes[LIMIT].id))));
    const del = await asUser(db, u, (tx) => tx.query(`delete from saves where recipe_id = $1`, [recipes[0].id]));
    expect(del.affectedRows).toBe(1);
    await asUser(db, u, (tx) => save(tx, recipes[LIMIT].id));
    expect(await countSaves(u)).toBe(LIMIT);
  });

  it("changing a save's recipe cannot get round the limit", async () => {
    const u = await createUser(db);
    const reel = await insertRecipe(db, { status: "live", source: "outside", owner_id: u });
    const [{ id: reelSave }] = await asUser(db, u, async (tx) => (await save(tx, reel.id)).rows);
    await saveMany(u, LIMIT);
    // 30 counted saves plus one outside save; repointing the outside save at a shef recipe would make 31
    await expect(
      asUser(db, u, (tx) => tx.query(`update saves set recipe_id = $2 where id = $1`, [reelSave, recipes[LIMIT].id])),
    ).rejects.toThrow(/saves_limit_reached/);
    expect(await asSuper(db, `select recipe_id from saves where id = $1`, [reelSave])).toEqual([{ recipe_id: reel.id }]);
  });

  it("saves of own outside recipes do not count toward 30", async () => {
    const u = await createUser(db);
    const reels: string[] = [];
    for (let i = 0; i < 3; i++) reels.push((await insertRecipe(db, { status: "live", source: "outside", owner_id: u })).id);
    for (const id of reels.slice(0, 2)) await asUser(db, u, (tx) => save(tx, id));
    await saveMany(u, LIMIT);
    expect(await countSaves(u)).toBe(LIMIT + 2);
    // still room for another of their own reels, but not another shef recipe
    await asUser(db, u, (tx) => save(tx, reels[2]));
    expectSavesLimit(await pgErrorOf(() => asUser(db, u, (tx) => save(tx, recipes[LIMIT].id))));
    expect(await countSaves(u)).toBe(LIMIT + 3);
  });

  it("at 30 saves, re-saving an already-saved recipe is a duplicate, not saves_limit_reached", async () => {
    // review N1: the app shows "already saved" for 23505 but "used 30 of 30" for the limit
    const u = await createUser(db);
    await saveMany(u, LIMIT);
    const err = await pgErrorOf(() => asUser(db, u, (tx) => save(tx, recipes[0].id)));
    expect(err.code).toBe("23505");
    expect(err.message).not.toMatch(/saves_limit_reached/);
    // also when re-saving into a folder
    const f = await asUser(db, u, (tx) => folder(tx, "Again"));
    const again = await pgErrorOf(() => asUser(db, u, (tx) => save(tx, recipes[1].id, f)));
    expect(again.code).toBe("23505");
    expect(await countSaves(u)).toBe(LIMIT);
  });

  it("only the user's own outside recipes are exempt from the limit", async () => {
    // review N3: someone else's outside recipe counts like any other save
    const owner = await createUser(db);
    const theirReel = await insertRecipe(db, { status: "live", source: "outside", owner_id: owner });
    // an admin can see (and so save) other people's outside recipes
    const adm = await createUser(db);
    await makeAdmin(db, adm);
    await saveMany(adm, LIMIT);
    expectSavesLimit(await pgErrorOf(() => asAdmin(db, adm, (tx) => save(tx, theirReel.id))));
    expect(await countSaves(adm)).toBe(LIMIT);
    // the trigger applies to any writer, e.g. a save inserted as superuser for a full user
    const full = await createUser(db);
    await saveMany(full, LIMIT);
    expectSavesLimit(
      await pgErrorOf(() =>
        asSuper(db, `insert into saves (user_id, recipe_id) values ($1, $2)`, [full, theirReel.id]),
      ),
    );
    // repointing an own-outside save at someone else's outside recipe is not exempt either
    const ownReel = await insertRecipe(db, { status: "live", source: "outside", owner_id: adm });
    await asSuper(db, `delete from saves where user_id = $1 and recipe_id = $2`, [adm, recipes[0].id]);
    await asAdmin(db, adm, (tx) => save(tx, recipes[0].id));
    const [{ id: ownSave }] = await asAdmin(db, adm, async (tx) => (await save(tx, ownReel.id)).rows);
    await expect(
      asAdmin(db, adm, (tx) => tx.query(`update saves set recipe_id = $2 where id = $1`, [ownSave, theirReel.id])),
    ).rejects.toThrow(/saves_limit_reached/);
    // the owner's own reel is still exempt for the owner
    const ownerFull = owner;
    await saveMany(ownerFull, LIMIT);
    await asUser(db, ownerFull, (tx) => save(tx, theirReel.id));
    expect(await countSaves(ownerFull)).toBe(LIMIT + 1);
  });

  it("the limit comes from saves_limit(uid)", async () => {
    const u = await createUser(db);
    expect(await asSuper(db, `select public.saves_limit($1::uuid) as n`, [u])).toEqual([{ n: LIMIT }]);
    const [trg] = await asSuper<{ prosecdef: boolean; proconfig: string[] | null }>(
      db,
      `select p.prosecdef, p.proconfig from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.saves'::regclass and not t.tgisinternal
         and (t.tgtype & 4) = 4 /* insert */ and (t.tgtype & 2) = 2 /* before */`,
    );
    expect(trg).toBeDefined();
    expect(trg.prosecdef).toBe(true);
    expect(trg.proconfig ?? []).toContainEqual(expect.stringMatching(/^search_path=(""|)$/));
  });

  it("the same recipe cannot be saved twice", async () => {
    const u = await createUser(db);
    const [a, b] = await asUser(db, u, async (tx) => [await folder(tx, "A"), await folder(tx, "B")]);
    await asUser(db, u, (tx) => save(tx, recipes[0].id));
    await expect(asUser(db, u, (tx) => save(tx, recipes[0].id))).rejects.toThrow();
    await expect(asUser(db, u, (tx) => save(tx, recipes[0].id, a))).rejects.toThrow();
    await asUser(db, u, (tx) => save(tx, recipes[1].id, a));
    await expect(asUser(db, u, (tx) => save(tx, recipes[1].id, b))).rejects.toThrow();
    await expect(asUser(db, u, (tx) => save(tx, recipes[1].id))).rejects.toThrow();
    expect(await countSaves(u)).toBe(2);
    // another user can still save the same recipe
    const other = await createUser(db);
    await asUser(db, other, (tx) => save(tx, recipes[0].id));
    expect(await countSaves(other)).toBe(1);
  });

  it("moving a save between own folders works", async () => {
    const u = await createUser(db);
    const [a, b] = await asUser(db, u, async (tx) => [await folder(tx, "A"), await folder(tx, "B")]);
    const [{ id }] = await asUser(db, u, async (tx) => (await save(tx, recipes[0].id, a)).rows);
    for (const target of [b, null, a]) {
      const res = await asUser(db, u, (tx) => tx.query(`update saves set folder_id = $2 where id = $1`, [id, target]));
      expect(res.affectedRows).toBe(1);
      expect(await asSuper(db, `select folder_id from saves where id = $1`, [id])).toEqual([{ folder_id: target }]);
    }
    // moving does not create a second save or trip the limit
    expect(await countSaves(u)).toBe(1);
    const full = await createUser(db);
    const fa = await asUser(db, full, (tx) => folder(tx, "Full"));
    await saveMany(full, LIMIT);
    const res = await asUser(db, full, (tx) => tx.query(`update saves set folder_id = $1 where recipe_id = $2`, [fa, recipes[0].id]));
    expect(res.affectedRows).toBe(1);
    // and cannot move into another user's folder
    await expect(
      asUser(db, full, (tx) => tx.query(`update saves set folder_id = $1 where recipe_id = $2`, [a, recipes[1].id])),
    ).rejects.toThrow();
  });

  it("deleting a folder keeps its saves, unfiled", async () => {
    const u = await createUser(db);
    const [a, b] = await asUser(db, u, async (tx) => [await folder(tx, "Gone"), await folder(tx, "Stays")]);
    await asUser(db, u, async (tx) => {
      await save(tx, recipes[0].id, a);
      await save(tx, recipes[1].id, a);
      await save(tx, recipes[2].id, b);
    });
    const del = await asUser(db, u, (tx) => tx.query(`delete from folders where id = $1`, [a]));
    expect(del.affectedRows).toBe(1);
    const rows = await asSuper<{ recipe_id: string; folder_id: string | null }>(
      db, `select recipe_id, folder_id from saves where user_id = $1 order by recipe_id`, [u],
    );
    expect(rows).toEqual(
      [
        { recipe_id: recipes[0].id, folder_id: null },
        { recipe_id: recipes[1].id, folder_id: null },
        { recipe_id: recipes[2].id, folder_id: b },
      ].sort((x, y) => x.recipe_id.localeCompare(y.recipe_id)),
    );
    // another user cannot delete the folder to unfile someone else's saves
    const other = await createUser(db);
    await expectBlockedWrite(() => asUser(db, other, (tx) => tx.query(`delete from folders where id = $1`, [b])));
    expect(await asSuper(db, `select folder_id from saves where recipe_id = $1 and user_id = $2`, [recipes[2].id, u])).toEqual([
      { folder_id: b },
    ]);
  });

  it("duplicate saves from before the migration are merged", async () => {
    const old = await createDb({ until: LIMIT_MIGRATION });
    const alice = await createUser(old);
    const bob = await createUser(old);
    const r1 = await insertRecipe(old, { status: "live" });
    const r2 = await insertRecipe(old, { status: "live" });
    const [fa] = await old.query<{ id: string }>(`insert into folders (user_id, name) values ($1, 'A') returning id`, [alice]).then((r) => r.rows);
    const [fb] = await old.query<{ id: string }>(`insert into folders (user_id, name) values ($1, 'B') returning id`, [alice]).then((r) => r.rows);
    const ins = (user: string, recipe: string, f: string | null, at: string) =>
      old.query<{ id: string }>(
        `insert into saves (user_id, recipe_id, folder_id, created_at) values ($1, $2, $3, $4) returning id`,
        [user, recipe, f, at],
      ).then((r) => r.rows[0].id);
    // the old unique key allowed one recipe once per folder (and once unfiled)
    await ins(alice, r1.id, null, "2026-03-01T00:00:00Z");
    const oldest = await ins(alice, r1.id, fa.id, "2026-01-01T00:00:00Z");
    await ins(alice, r1.id, fb.id, "2026-02-01T00:00:00Z");
    const single = await ins(alice, r2.id, fb.id, "2026-01-15T00:00:00Z");
    const bobs = await ins(bob, r1.id, null, "2026-04-01T00:00:00Z");

    await applyMigrationsFrom(old, LIMIT_MIGRATION);

    const rows = (await old.query<{ id: string; user_id: string; recipe_id: string; folder_id: string | null }>(
      `select id, user_id, recipe_id, folder_id from saves order by created_at`,
    )).rows;
    expect(rows).toEqual([
      { id: oldest, user_id: alice, recipe_id: r1.id, folder_id: fa.id },
      { id: single, user_id: alice, recipe_id: r2.id, folder_id: fb.id },
      { id: bobs, user_id: bob, recipe_id: r1.id, folder_id: null },
    ]);
    // and the new key holds from now on
    await expect(
      old.query(`insert into saves (user_id, recipe_id, folder_id) values ($1, $2, $3)`, [alice, r1.id, fb.id]),
    ).rejects.toThrow();
  });
});
