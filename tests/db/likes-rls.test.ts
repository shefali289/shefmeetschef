// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAnon, asSuper, asUser, banUser, createDb, createUser, expectBlockedWrite, insertRecipe, pgErrorOf, seedRemix, uuid,
  type RemixStatus,
} from "./helpers/db";

/*
 * Task 3 slice A contract (likes):
 *   likes_insert_own: user_id = auth.uid() and remix_is_public(remix_id) (an approved remix of a
 *   live Shef recipe by a user who is not banned). Restrictive insert: not is_banned().
 *   Delete own stays. like_count comes from remix_feed (likes rows are own-row only).
 */

let db: PGlite;
let alice: string;
let bob: string;
let carol: string;
let recipe: { id: string; slug: string };

const like = (uid: string, remixId: string) =>
  asUser(db, uid, async (tx) =>
    (await tx.query<{ user_id: string; remix_id: string }>(`insert into likes (remix_id) values ($1) returning user_id, remix_id`, [remixId])).rows[0],
  );

const remix = (owner: string, status: RemixStatus = "approved", recipeId = recipe.id) =>
  seedRemix(db, { recipe_id: recipeId, user_id: owner, status }).then((r) => r.id);

async function likesOn(remixId: string) {
  return (await asSuper<{ user_id: string }>(db, `select user_id from likes where remix_id = $1 order by user_id`, [remixId])).map((r) => r.user_id);
}

async function likeCount(recipeId: string, remixId: string): Promise<number | undefined> {
  const rows = await asAnon(db, async (tx) =>
    (await tx.query<{ id: string; like_count: number | string }>(
      `select id, like_count from public.remix_feed(p_recipe_id => $1, p_challenge_id => null, p_sort => 'newest', p_limit => 48, p_offset => 0)`,
      [recipeId],
    )).rows,
  );
  const row = rows.find((r) => r.id === remixId);
  return row === undefined ? undefined : Number(row.like_count);
}

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db);
  bob = await createUser(db);
  carol = await createUser(db);
  recipe = await insertRecipe(db, { status: "live" });
});

describe("likes RLS (task 3)", () => {
  it("user likes an approved remix once and a second like is a duplicate", async () => {
    const id = await remix(alice);
    const row = await like(bob, id);
    expect(row).toEqual({ user_id: bob, remix_id: id });
    const err = await pgErrorOf(() => like(bob, id));
    expect(err.code).toBe("23505");
    expect(await likesOn(id)).toEqual([bob]);
    // a like cannot be made in someone else's name
    await expect(
      asUser(db, bob, (tx) => tx.query(`insert into likes (user_id, remix_id) values ($1, $2)`, [carol, id])),
    ).rejects.toThrow();
    expect(await likesOn(id)).toEqual([bob]);
  });

  it("user can like their own approved remix", async () => {
    const id = await remix(alice);
    expect(await like(alice, id)).toEqual({ user_id: alice, remix_id: id });
  });

  it("liking a pending or hidden remix is refused", async () => {
    const pending = await remix(alice, "pending");
    const hidden = await remix(alice, "hidden");
    for (const id of [pending, hidden]) {
      // not by another user, and not by the owner, who can see it
      for (const uid of [bob, alice]) {
        const err = await pgErrorOf(() => like(uid, id));
        expect({ id, uid, code: err.code }).toEqual({ id, uid, code: "42501" });
      }
      expect(await likesOn(id)).toEqual([]);
    }
    // an approved remix of a recipe that is no longer live is not public either
    const gone = await insertRecipe(db, { status: "live" });
    const onGone = await remix(alice, "approved", gone.id);
    await asSuper(db, `update recipes set status = 'draft' where id = $1`, [gone.id]);
    await expect(like(bob, onGone)).rejects.toThrow();
    // nor is a remix id that does not exist
    await expect(like(bob, uuid())).rejects.toThrow();
    expect(await likesOn(onGone)).toEqual([]);
  });

  it("banned user cannot like", async () => {
    const u = await createUser(db);
    const id = await remix(alice);
    await banUser(db, u);
    const err = await pgErrorOf(() => like(u, id));
    expect(err.code).toBe("42501");
    expect(await likesOn(id)).toEqual([]);
    // an approved remix by a banned author cannot be liked either
    const banned = await createUser(db);
    const byBanned = await remix(banned);
    await banUser(db, banned);
    await expect(like(bob, byBanned)).rejects.toThrow();
    expect(await likesOn(byBanned)).toEqual([]);
  });

  it("anon cannot like", async () => {
    const id = await remix(alice);
    await expect(asAnon(db, (tx) => tx.query(`insert into likes (remix_id) values ($1)`, [id]))).rejects.toThrow();
    await expect(
      asAnon(db, (tx) => tx.query(`insert into likes (user_id, remix_id) values ($1, $2)`, [bob, id])),
    ).rejects.toThrow();
    expect(await likesOn(id)).toEqual([]);
  });

  it("user removes only their own like", async () => {
    const id = await remix(alice);
    await like(bob, id);
    await like(carol, id);
    await expectBlockedWrite(() => asUser(db, bob, (tx) => tx.query(`delete from likes where user_id = $1`, [carol])));
    await expectBlockedWrite(() => asAnon(db, (tx) => tx.query(`delete from likes where remix_id = $1`, [id])));
    // likes have no updates: moving a like to another user or remix is impossible
    await expectBlockedWrite(() => asUser(db, bob, (tx) => tx.query(`update likes set user_id = $2 where remix_id = $1`, [id, alice])));
    expect(await likesOn(id)).toEqual([bob, carol].sort());
    const del = await asUser(db, bob, (tx) => tx.query(`delete from likes where remix_id = $1`, [id]));
    expect(del.affectedRows).toBe(1);
    expect(await likesOn(id)).toEqual([carol]);
    // a user can like again after unliking
    await like(bob, id);
    expect(await likesOn(id)).toEqual([bob, carol].sort());
  });

  it("like_count counts each user once", async () => {
    const r = await insertRecipe(db, { status: "live" });
    const id = await remix(alice, "approved", r.id);
    const other = await remix(bob, "approved", r.id);
    expect(await likeCount(r.id, id)).toBe(0);
    for (const uid of [alice, bob, carol]) await like(uid, id);
    await expect(like(bob, id)).rejects.toThrow();
    await like(carol, other);
    expect(await likeCount(r.id, id)).toBe(3);
    expect(await likeCount(r.id, other)).toBe(1);
    await asUser(db, carol, (tx) => tx.query(`delete from likes where remix_id = $1`, [id]));
    expect(await likeCount(r.id, id)).toBe(2);
  });
});
