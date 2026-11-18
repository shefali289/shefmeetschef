// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, banUser, createDb, createUser, expectBlockedWrite, insertRecipe, makeAdmin,
  pgErrorOf, seedRemix, uploadObject, uuid, visibleRows,
} from "./helpers/db";

/*
 * Task 3 slice A contract (remixes):
 *   insert only by the signed-in user, of a live Shef recipe, with a photo object that exists in the
 *   caller's remix-photos folder and is used by no other remix, and "what I changed" of 1 to 2000
 *   characters (trimmed). A before-insert trigger (anon/authenticated only) forces status pending,
 *   created_at now() and challenge_id null, then spends the 'remix' usage (5 a NZ day, SMU01
 *   usage_limit_reached). Banned users cannot insert. Nobody updates remixes from the API.
 */

let db: PGlite;
let alice: string;
let bob: string;
let admin: string;
let live: { id: string; slug: string };
let draft: { id: string; slug: string };

const EARLIER_MONTH = "2026-01-15T00:00:00Z";
const REMIX_COLUMNS = ["recipe_id", "user_id", "challenge_id", "photo_path", "changes", "status", "created_at", "updated_at"];

type RemixRow = { id: string; user_id: string; status: string; challenge_id: string | null; photo_path: string; created_at: string };

/** Seeds a remix as superuser with a unique photo, returning its id. */
async function seed(owner: string) {
  return (await seedRemix(db, { recipe_id: live.id, user_id: owner })).id;
}

/** Uploads a photo as the user (unless a path is given) and inserts the remix as that user. */
async function post(uid: string, opts: { recipeId?: string; changes?: string | null; path?: string } = {}) {
  const path = opts.path ?? (await uploadObject(db, uid));
  return asUser(db, uid, async (tx) =>
    (await tx.query<RemixRow>(
      `insert into remixes (recipe_id, photo_path, changes) values ($1, $2, $3)
       returning id, user_id, status, challenge_id, photo_path, created_at`,
      [opts.recipeId ?? live.id, path, opts.changes === undefined ? "swapped cream for yoghurt" : opts.changes],
    )).rows[0],
  );
}

/** Remixes spent today (NZ day) by the user, read as superuser. */
async function remixesUsed(uid: string): Promise<number> {
  const rows = await asSuper<{ count: number }>(
    db,
    `select count from usage where user_id = $1 and kind = 'remix' and period = public.usage_period('remix', now())`,
    [uid],
  );
  return rows[0]?.count ?? 0;
}

async function remixCount(uid: string): Promise<number> {
  const [row] = await asSuper<{ n: number }>(db, `select count(*)::int as n from remixes where user_id = $1`, [uid]);
  return row.n;
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
    // CHANGED IN TASK 3 (slice A, on purpose): the photo object must be uploaded to the user's
    // remix-photos folder before the remix can point at it.
    const photo = await uploadObject(db, alice, { name: `${alice}/garlic.jpg` });
    const row = await asUser(db, alice, async (tx) =>
      (await tx.query<{ id: string; user_id: string }>(
        `insert into remixes (recipe_id, photo_path, changes) values ($1, $2, 'extra garlic') returning id, user_id`,
        [live.id, photo],
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
    // fixture only: seeded photos now need unique paths (unique index on photo_path)
    const { id, photo_path } = await seedRemix(db, { recipe_id: live.id, user_id: alice });
    await expect(
      asUser(db, alice, (tx) => tx.query(`update remixes set photo_path = $2 where id = $1`, [id, `${bob}/x.jpg`])),
    ).rejects.toThrow();
    expect(await asSuper(db, `select photo_path from remixes where id = $1`, [id])).toEqual([{ photo_path }]);
  });

  it("user cannot point a remix at a draft recipe", async () => {
    const id = await seed(alice);
    await expect(
      asUser(db, alice, (tx) => tx.query(`update remixes set recipe_id = $2 where id = $1`, [id, draft.id])),
    ).rejects.toThrow();
    expect(await asSuper(db, `select recipe_id from remixes where id = $1`, [id])).toEqual([{ recipe_id: live.id }]);
  });

  it("other user cannot select, update or delete a remix", async () => {
    const id = await seed(alice);
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
    const a = await seed(alice);
    const b = await seed(bob);
    const rows = await asAdmin(db, admin, async (tx) => (await tx.query<{ id: string }>(`select id from remixes`)).rows);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
  });

  it("anon sees no remixes", async () => {
    await seed(alice);
    const rows = await visibleRows(() => asAnon(db, (tx) => tx.query(`select id from remixes`)));
    expect(rows).toHaveLength(0);
  });
});

describe("posting remixes (task 3)", () => {
  it("user posts a remix of a live Shef recipe and it starts pending", async () => {
    const u = await createUser(db);
    const before = Date.now();
    const row = await post(u);
    expect(row.user_id).toBe(u);
    expect(row.status).toBe("pending");
    expect(row.challenge_id).toBeNull();
    expect(Math.abs(new Date(row.created_at).getTime() - before)).toBeLessThan(60_000);
    expect(await asSuper(db, `select status, changes from remixes where id = $1`, [row.id])).toEqual([
      { status: "pending", changes: "swapped cream for yoghurt" },
    ]);
    // posting spends one of today's remixes
    expect(await remixesUsed(u)).toBe(1);
  });

  it("status cannot be sent by the client and the trigger forces pending", async () => {
    const u = await createUser(db);
    const photo = await uploadObject(db, u);
    const err = await pgErrorOf(() =>
      asUser(db, u, (tx) =>
        tx.query(`insert into remixes (recipe_id, photo_path, changes, status) values ($1, $2, 'x', 'approved')`, [live.id, photo]),
      ),
    );
    expect(err.code).toBe("42501");
    for (const col of ["status", "created_at", "updated_at"]) {
      const [p] = await asSuper<{ ok: boolean }>(db, `select has_column_privilege('authenticated', 'public.remixes', $1, 'INSERT') as ok`, [col]);
      expect({ col, insert: p.ok }).toEqual({ col, insert: false });
    }
    // even if a grant slipped in later, the trigger still forces pending and now()
    await asSuper(db, `grant insert (status, created_at) on public.remixes to authenticated`);
    try {
      const row = await asUser(db, u, async (tx) =>
        (await tx.query<RemixRow>(
          `insert into remixes (recipe_id, photo_path, changes, status, created_at)
           values ($1, $2, 'sneaky', 'approved', '2020-01-01T00:00:00Z') returning id, status, created_at`,
          [live.id, photo],
        )).rows[0],
      );
      expect(row.status).toBe("pending");
      expect(new Date(row.created_at).getUTCFullYear()).toBeGreaterThanOrEqual(2026);
    } finally {
      await asSuper(db, `revoke insert (status, created_at) on public.remixes from authenticated`);
    }
  });

  it("challenge_id cannot be set by the client", async () => {
    const u = await createUser(db);
    const other = await insertRecipe(db, { status: "live" });
    // a past challenge on another recipe, so no later slice would enter this remix on its own
    const [ch] = await asSuper<{ id: string }>(
      db,
      `insert into challenges (base_recipe_id, title, starts_on, ends_on) values ($1, 'Old week', '2026-01-05', '2026-01-11') returning id`,
      [other.id],
    );
    const photo = await uploadObject(db, u);
    const err = await pgErrorOf(() =>
      asUser(db, u, (tx) =>
        tx.query(`insert into remixes (recipe_id, photo_path, changes, challenge_id) values ($1, $2, 'x', $3)`, [live.id, photo, ch.id]),
      ),
    );
    expect(err.code).toBe("42501");
    const [p] = await asSuper<{ ok: boolean }>(
      db, `select has_column_privilege('authenticated', 'public.remixes', 'challenge_id', 'INSERT') as ok`,
    );
    expect(p.ok).toBe(false);
    expect(await remixCount(u)).toBe(0);
    // even with a stray grant the trigger clears it
    await asSuper(db, `grant insert (challenge_id) on public.remixes to authenticated`);
    try {
      const row = await asUser(db, u, async (tx) =>
        (await tx.query<RemixRow>(
          `insert into remixes (recipe_id, photo_path, changes, challenge_id) values ($1, $2, 'x', $3) returning challenge_id`,
          [live.id, photo, ch.id],
        )).rows[0],
      );
      expect(row.challenge_id).toBeNull();
    } finally {
      await asSuper(db, `revoke insert (challenge_id) on public.remixes from authenticated`);
    }
  });

  it("remix of a draft or an outside recipe, even the user's own, is refused", async () => {
    const u = await createUser(db);
    const ownReel = await insertRecipe(db, { status: "live", source: "outside", owner_id: u, created_at: EARLIER_MONTH });
    const otherReel = await insertRecipe(db, { status: "live", source: "outside", owner_id: bob, created_at: EARLIER_MONTH });
    // the user can see their own reel, so only the new rule stops this
    const sees = await asUser(db, u, async (tx) => (await tx.query(`select id from recipes where id = $1`, [ownReel.id])).rows);
    expect(sees).toHaveLength(1);
    // one real photo for every attempt, so only the recipe rule can refuse them
    const photo = await uploadObject(db, u);
    for (const recipe of [draft, ownReel, otherReel]) {
      const err = await pgErrorOf(() => post(u, { recipeId: recipe.id, path: photo }));
      expect({ recipe: recipe.slug, code: err.code }).toEqual({ recipe: recipe.slug, code: "42501" });
    }
    expect(await remixCount(u)).toBe(0);
    expect(await remixesUsed(u)).toBe(0);
    // a recipe id that does not exist is refused too
    expect((await pgErrorOf(() => post(u, { recipeId: uuid(), path: photo }))).code).toBe("42501");
    expect(await remixCount(u)).toBe(0);
  });

  it("photo must exist in the caller's remix-photos folder", async () => {
    const u = await createUser(db);
    // a path in the user's folder that was never uploaded
    expect((await pgErrorOf(() => post(u, { path: `${u}/${uuid()}.jpg` }))).code).toBe("23503");
    // an object with that name in another bucket does not count
    const elsewhere = `${u}/${uuid()}.jpg`;
    await asSuper(db, `insert into storage.objects (bucket_id, name) values ('drafts', $1)`, [elsewhere]);
    expect((await pgErrorOf(() => post(u, { path: elsewhere }))).code).toBe("23503");
    // someone else's uploaded photo cannot be used (the caller cannot see it)
    const bobsPhoto = await uploadObject(db, bob);
    expect((await pgErrorOf(() => post(u, { path: bobsPhoto }))).code).toBe("23503");
    expect(await remixCount(u)).toBe(0);
    expect(await remixesUsed(u)).toBe(0);
    // once uploaded it works
    const uploaded = await uploadObject(db, u);
    expect((await post(u, { path: uploaded })).photo_path).toBe(uploaded);
  });

  it("the same photo cannot be used by two remixes", async () => {
    const u = await createUser(db);
    const photo = await uploadObject(db, u);
    await post(u, { path: photo });
    await expect(post(u, { path: photo })).rejects.toThrow();
    expect(await remixCount(u)).toBe(1);
    expect(await remixesUsed(u)).toBe(1);
    // the database itself refuses a duplicate path, not just the API
    const err = await pgErrorOf(() =>
      asSuper(db, `insert into remixes (recipe_id, user_id, photo_path, changes) values ($1, $2, $3, 'again')`, [live.id, u, photo]),
    );
    expect(err.code).toBe("23505");
  });

  it("photo is required and changes must be 1 to 2000 characters", async () => {
    const u = await createUser(db);
    // no photo
    await expect(
      asUser(db, u, (tx) => tx.query(`insert into remixes (recipe_id, changes) values ($1, 'no photo')`, [live.id])),
    ).rejects.toThrow();
    // missing, empty, blank and too long text
    for (const changes of [null, "", "   \n\t ", "x".repeat(2001)]) {
      await expect(post(u, { changes })).rejects.toThrow();
    }
    expect(await remixCount(u)).toBe(0);
    expect(await remixesUsed(u)).toBe(0);
    // the edges are fine
    await post(u, { changes: "x" });
    await post(u, { changes: "y".repeat(2000) });
    expect(await remixCount(u)).toBe(2);
    // the rule also binds rows written outside the API
    await expect(
      asSuper(db, `insert into remixes (recipe_id, user_id, photo_path, changes) values ($1, $2, $3, '  ')`, [live.id, u, `${u}/blank.jpg`]),
    ).rejects.toThrow();
    await expect(
      asSuper(db, `insert into remixes (recipe_id, user_id, photo_path, changes) values ($1, $2, null, 'ok')`, [live.id, u]),
    ).rejects.toThrow();
  });

  it("changes made only of invisible or non-breaking spaces are refused like blank text", async () => {
    const u = await createUser(db);
    const photo = await uploadObject(db, u); // reused: refused inserts leave it unused
    const blanks = [
      "\u00A0", // no-break space
      "\u200B", // zero-width space
      "\uFEFF", // byte order mark
      "\u00A0\u00A0\u00A0",
      " \u00A0 \u200B\uFEFF\t\n ",
      "\u200B\u200B\uFEFF\u00A0",
    ];
    for (const changes of blanks) {
      const err = await pgErrorOf(() => post(u, { path: photo, changes }));
      expect({ changes: JSON.stringify(changes), code: err.code }).toEqual({ changes: JSON.stringify(changes), code: "23514" });
      // the rule binds rows written outside the API too
      await expect(
        asSuper(db, `insert into remixes (recipe_id, user_id, photo_path, changes) values ($1, $2, $3, $4)`, [live.id, u, `${u}/${uuid()}.jpg`, changes]),
      ).rejects.toThrow();
    }
    expect(await remixCount(u)).toBe(0);
    expect(await remixesUsed(u)).toBe(0);
    // real text that merely contains those characters is fine
    const row = await post(u, { path: photo, changes: "\u00A0less\u00A0salt\u200B" });
    expect(row.photo_path).toBe(photo);
  });

  it("users cannot update any remix column, even their own", async () => {
    const u = await createUser(db);
    const row = await post(u);
    for (const col of REMIX_COLUMNS) {
      const [p] = await asSuper<{ ok: boolean }>(db, `select has_column_privilege('authenticated', 'public.remixes', $1, 'UPDATE') as ok`, [col]);
      expect({ col, update: p.ok }).toEqual({ col, update: false });
    }
    const attempts: [string, unknown][] = [
      ["changes", "edited after approval"],
      ["photo_path", `${u}/${uuid()}.jpg`],
      ["recipe_id", live.id],
      ["status", "approved"],
      ["user_id", bob],
      ["challenge_id", null],
    ];
    for (const [col, value] of attempts) {
      const err = await pgErrorOf(() => asUser(db, u, (tx) => tx.query(`update remixes set ${col} = $2 where id = $1`, [row.id, value])));
      expect({ col, code: err.code }).toEqual({ col, code: "42501" });
    }
    expect(await asSuper(db, `select changes, status, user_id, photo_path from remixes where id = $1`, [row.id])).toEqual([
      { changes: "swapped cream for yoghurt", status: "pending", user_id: u, photo_path: row.photo_path },
    ]);
    // the old update policy is gone
    expect(await asSuper(db, `select policyname from pg_policies where tablename = 'remixes' and cmd = 'UPDATE'`)).toEqual([]);
  });

  it("admin cannot update status directly", async () => {
    const id = await seed(alice);
    const err = await pgErrorOf(() => asAdmin(db, admin, (tx) => tx.query(`update remixes set status = 'approved' where id = $1`, [id])));
    expect(err.code).toBe("42501");
    // not even on the admin's own remix, or any other column
    const own = await seedRemix(db, { recipe_id: live.id, user_id: admin });
    for (const sql of [`update remixes set status = 'approved' where id = $1`, `update remixes set changes = 'edited' where id = $1`]) {
      const e = await pgErrorOf(() => asAdmin(db, admin, (tx) => tx.query(sql, [own.id])));
      expect(e.code).toBe("42501");
    }
    expect(await asSuper(db, `select status from remixes where id = any($1) order by status`, [[id, own.id]])).toEqual([
      { status: "pending" },
      { status: "pending" },
    ]);
    expect(await asSuper(db, `select changes from remixes where id = $1`, [own.id])).toEqual([{ changes: "less salt" }]);
  });

  it("a remix in someone else's name is refused even with a photo the caller can see", async () => {
    // the admin can read every remix photo (moderation), so the photo check passes and only
    // remixes_insert_own (user_id = auth.uid()) can stop this
    const owner = await createUser(db);
    const photo = await uploadObject(db, owner);
    const adminSees = await asAdmin(db, admin, async (tx) =>
      (await tx.query(`select name from storage.objects where bucket_id = 'remix-photos' and name = $1`, [photo])).rows,
    );
    expect(adminSees).toHaveLength(1);
    const adminUsedBefore = await remixesUsed(admin);
    const err = await pgErrorOf(() =>
      asAdmin(db, admin, (tx) =>
        tx.query(`insert into remixes (recipe_id, user_id, photo_path, changes) values ($1, $2, $3, 'on your behalf')`, [live.id, owner, photo]),
      ),
    );
    expect(err.code).toBe("42501");
    expect(await asSuper(db, `select id from remixes where photo_path = $1`, [photo])).toHaveLength(0);
    expect(await remixesUsed(admin)).toBe(adminUsedBefore);
    expect(await remixesUsed(owner)).toBe(0);
  });

  it("owner deletes own remix, other user cannot", async () => {
    const u = await createUser(db);
    const row = await post(u);
    await expectBlockedWrite(() => asUser(db, bob, (tx) => tx.query(`delete from remixes where id = $1`, [row.id])));
    await expectBlockedWrite(() => asAnon(db, (tx) => tx.query(`delete from remixes where id = $1`, [row.id])));
    expect(await remixCount(u)).toBe(1);
    const del = await asUser(db, u, (tx) => tx.query(`delete from remixes where id = $1`, [row.id]));
    expect(del.affectedRows).toBe(1);
    expect(await remixCount(u)).toBe(0);
  });

  it("banned user cannot post a remix", async () => {
    const u = await createUser(db);
    const photo = await uploadObject(db, u); // uploaded before the ban
    await banUser(db, u, { by: admin });
    const err = await pgErrorOf(() => post(u, { path: photo }));
    expect(err.code).toBe("42501");
    expect(err.message).not.toMatch(/usage_limit_reached/);
    expect(await remixCount(u)).toBe(0);
    expect(await remixesUsed(u)).toBe(0);
    // other users are not affected
    expect((await post(bob)).status).toBe("pending");
  });

  it("the sixth remix in an NZ day raises usage_limit_reached and nothing is inserted", async () => {
    const u = await createUser(db);
    for (let i = 0; i < 5; i++) await post(u, { changes: `remix ${i + 1}` });
    const photo = await uploadObject(db, u);
    const err = await pgErrorOf(() => post(u, { path: photo }));
    expect(err.message).toMatch(/usage_limit_reached/);
    expect(err.code).toBe("SMU01");
    expect(await remixCount(u)).toBe(5);
    expect(await remixesUsed(u)).toBe(5);
    expect(await asSuper(db, `select id from remixes where photo_path = $1`, [photo])).toHaveLength(0);
    // the counter the app shows agrees
    const left = await asUser(db, u, async (tx) =>
      (await tx.query<{ n: number }>(`select public.usage_remaining('remix', 5) as n`)).rows[0].n,
    );
    expect(left).toBe(0);
  });

  it("a refused insert does not spend a remix", async () => {
    const u = await createUser(db);
    const used = await uploadObject(db, u);
    await post(u, { path: used });
    expect(await remixesUsed(u)).toBe(1);
    const spare = await uploadObject(db, u);
    const refused: [string, () => Promise<unknown>, string][] = [
      ["draft recipe", () => post(u, { recipeId: draft.id, path: spare }), "42501"],
      ["never uploaded", () => post(u, { path: `${u}/${uuid()}.jpg` }), "23503"],
      ["empty changes", () => post(u, { changes: "", path: spare }), "23514"],
      ["too long", () => post(u, { changes: "z".repeat(2001), path: spare }), "23514"],
      ["photo already used", () => post(u, { path: used }), "23505"],
      ["someone else's user_id", () => asUser(db, u, (tx) =>
        tx.query(`insert into remixes (recipe_id, user_id, photo_path, changes) values ($1, $2, $3, 'x')`, [live.id, bob, `${bob}/x.jpg`]),
      ), "23503"],
    ];
    for (const [what, run, code] of refused) {
      expect({ what, code: (await pgErrorOf(run)).code }).toEqual({ what, code });
    }
    expect(await remixesUsed(u)).toBe(1);
    expect(await remixCount(u)).toBe(1);
  });

  it("deleting a remix does not give it back", async () => {
    const u = await createUser(db);
    const row = await post(u);
    await asUser(db, u, (tx) => tx.query(`delete from remixes where id = $1`, [row.id]));
    expect(await remixCount(u)).toBe(0);
    expect(await remixesUsed(u)).toBe(1);
    const left = await asUser(db, u, async (tx) =>
      (await tx.query<{ n: number }>(`select public.usage_remaining('remix', 5) as n`)).rows[0].n,
    );
    expect(left).toBe(4);
  });

  it("the cap is per user", async () => {
    const u = await createUser(db);
    const v = await createUser(db);
    for (let i = 0; i < 5; i++) await post(u);
    await expect(post(u)).rejects.toThrow(/usage_limit_reached/);
    expect((await post(v)).status).toBe("pending");
    expect(await remixesUsed(u)).toBe(5);
    expect(await remixesUsed(v)).toBe(1);
  });
});
