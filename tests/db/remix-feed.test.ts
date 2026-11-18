// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, banUser, createDb, createUser, insertRecipe, makeAdmin, seedRemix, visibleRows,
  type RemixStatus, type Tx,
} from "./helpers/db";

/*
 * Task 3 slice A contract (public reads):
 *   remix_feed(p_recipe_id uuid, p_challenge_id uuid, p_sort text 'newest'|'likes', p_limit int,
 *   p_offset int) returns id, recipe_id, recipe_slug, recipe_title, challenge_id, changes,
 *   photo_path, author_name, like_count, created_at for approved remixes of live Shef recipes by
 *   users who are not banned. Null filters mean "any". Limit clamped to 1..48. Security definer,
 *   search_path = '', execute to anon and authenticated (not public). author_name is the first
 *   word of profiles.name (max 40 chars), else 'A home cook'. Never user_id, email or moderation.
 *   The remixes table itself stays own-row or admin.
 */

const FEED_COLUMNS = [
  "id", "recipe_id", "recipe_slug", "recipe_title", "challenge_id", "changes", "photo_path", "author_name", "like_count",
  "created_at",
].sort();

type FeedRow = {
  id: string;
  recipe_id: string;
  recipe_slug: string;
  recipe_title: string;
  challenge_id: string | null;
  changes: string;
  photo_path: string;
  author_name: string;
  like_count: number | string;
  created_at: string;
};

type FeedArgs = { recipe?: string | null; challenge?: string | null; sort?: "newest" | "likes"; limit?: number; offset?: number };

let db: PGlite;
let alice: string;
let bob: string;
let admin: string;

const feedQuery = (tx: Tx, a: FeedArgs = {}) =>
  tx.query<FeedRow>(
    `select * from public.remix_feed(p_recipe_id => $1, p_challenge_id => $2, p_sort => $3, p_limit => $4, p_offset => $5)`,
    [a.recipe ?? null, a.challenge ?? null, a.sort ?? "newest", a.limit ?? 48, a.offset ?? 0],
  );
const anonFeed = (a: FeedArgs = {}) => asAnon(db, async (tx) => (await feedQuery(tx, a)).rows);
const userFeed = (uid: string, a: FeedArgs = {}) => asUser(db, uid, async (tx) => (await feedQuery(tx, a)).rows);

const remix = (recipeId: string, owner: string, status: RemixStatus = "approved", extra: { created_at?: string; challenge_id?: string; changes?: string } = {}) =>
  seedRemix(db, { recipe_id: recipeId, user_id: owner, status, ...extra }).then((r) => r.id);

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db, { email: "alice@example.com", meta: { full_name: "Alice Wong" } });
  bob = await createUser(db, { email: "bob@example.com", meta: { full_name: "Bob" } });
  admin = await createUser(db);
  await makeAdmin(db, admin);
});

describe("remix_feed", () => {
  it("anon and users see approved remixes through remix_feed", async () => {
    const r = await insertRecipe(db, { status: "live", title: "Butter chicken" });
    const id = await remix(r.id, alice, "approved", { changes: "used paneer" });
    for (const rows of [await anonFeed({ recipe: r.id }), await userFeed(bob, { recipe: r.id }), await userFeed(alice, { recipe: r.id })]) {
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id, recipe_id: r.id, recipe_slug: r.slug, recipe_title: "Butter chicken", changes: "used paneer", challenge_id: null,
      });
      expect(rows[0].photo_path).toMatch(new RegExp(`^${alice}/`));
    }
    const [fn] = await asSuper<{ prosecdef: boolean; proconfig: string[] | null; anon: boolean; authed: boolean; pub: boolean }>(
      db,
      `select p.prosecdef, p.proconfig,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'remix_feed'`,
    );
    expect(fn).toMatchObject({ prosecdef: true, anon: true, authed: true, pub: false });
    expect(fn.proconfig ?? []).toContainEqual(expect.stringMatching(/^search_path=(""|)$/));
  });

  it("pending and hidden remixes are not in the feed, even for their owner", async () => {
    const r = await insertRecipe(db, { status: "live" });
    const approved = await remix(r.id, alice, "approved");
    await remix(r.id, alice, "pending");
    await remix(r.id, alice, "hidden");
    for (const rows of [await anonFeed({ recipe: r.id }), await userFeed(alice, { recipe: r.id }), await userFeed(admin, { recipe: r.id })]) {
      expect(rows.map((x) => x.id)).toEqual([approved]);
    }
  });

  it("remixes by banned users are not in the feed", async () => {
    const r = await insertRecipe(db, { status: "live" });
    const troll = await createUser(db, { meta: { full_name: "Troll" } });
    const ok = await remix(r.id, alice);
    await remix(r.id, troll);
    expect((await anonFeed({ recipe: r.id })).map((x) => x.id).sort()).toHaveLength(2);
    await banUser(db, troll);
    expect((await anonFeed({ recipe: r.id })).map((x) => x.id)).toEqual([ok]);
    expect((await userFeed(troll, { recipe: r.id })).map((x) => x.id)).toEqual([ok]);
  });

  it("remixes of a recipe that is no longer live are not in the feed", async () => {
    const r = await insertRecipe(db, { status: "live" });
    const id = await remix(r.id, alice);
    expect((await anonFeed({ recipe: r.id })).map((x) => x.id)).toEqual([id]);
    await asSuper(db, `update recipes set status = 'draft' where id = $1`, [r.id]);
    expect(await anonFeed({ recipe: r.id })).toEqual([]);
    expect((await anonFeed()).map((x) => x.id)).not.toContain(id);
    // an approved remix of an outside recipe (seeded) never shows either
    const reel = await insertRecipe(db, { status: "live", source: "outside", owner_id: bob, created_at: "2026-01-15T00:00:00Z" });
    const onReel = await remix(reel.id, bob);
    expect((await anonFeed()).map((x) => x.id)).not.toContain(onReel);
    expect(await anonFeed({ recipe: reel.id })).toEqual([]);
  });

  it("feed filters by recipe and by challenge", async () => {
    const r1 = await insertRecipe(db, { status: "live" });
    const r2 = await insertRecipe(db, { status: "live" });
    const [ch] = await asSuper<{ id: string }>(
      db,
      `insert into challenges (base_recipe_id, title, starts_on, ends_on) values ($1, 'Week', '2026-02-02', '2026-02-08') returning id`,
      [r1.id],
    );
    const entry = await remix(r1.id, alice, "approved", { challenge_id: ch.id });
    const plain = await remix(r1.id, bob);
    const other = await remix(r2.id, alice);
    expect((await anonFeed({ recipe: r1.id })).map((x) => x.id).sort()).toEqual([entry, plain].sort());
    expect((await anonFeed({ recipe: r2.id })).map((x) => x.id)).toEqual([other]);
    const byChallenge = await anonFeed({ challenge: ch.id });
    expect(byChallenge.map((x) => x.id)).toEqual([entry]);
    expect(byChallenge[0].challenge_id).toBe(ch.id);
    expect((await anonFeed({ recipe: r2.id, challenge: ch.id }))).toEqual([]);
    // no filter: everything approved and public
    const all = (await anonFeed()).map((x) => x.id);
    for (const id of [entry, plain, other]) expect(all).toContain(id);
  });

  it("feed is newest first, or by like count when sorted by likes", async () => {
    const r = await insertRecipe(db, { status: "live" });
    const oldest = await remix(r.id, alice, "approved", { created_at: minutesAgo(30) });
    const middle = await remix(r.id, bob, "approved", { created_at: minutesAgo(20) });
    const newest = await remix(r.id, alice, "approved", { created_at: minutesAgo(10) });
    expect((await anonFeed({ recipe: r.id })).map((x) => x.id)).toEqual([newest, middle, oldest]);
    const fans = [alice, bob, admin, await createUser(db)];
    for (const u of fans) await asSuper(db, `insert into likes (user_id, remix_id) values ($1, $2)`, [u, oldest]);
    for (const u of fans.slice(0, 2)) await asSuper(db, `insert into likes (user_id, remix_id) values ($1, $2)`, [u, middle]);
    const byLikes = await anonFeed({ recipe: r.id, sort: "likes" });
    expect(byLikes.map((x) => x.id)).toEqual([oldest, middle, newest]);
    expect(byLikes.map((x) => Number(x.like_count))).toEqual([4, 2, 0]);
    // paging with offset
    expect((await anonFeed({ recipe: r.id, limit: 1, offset: 1 })).map((x) => x.id)).toEqual([middle]);
  });

  it("feed gives the first name only and never user_id or email", async () => {
    const r = await insertRecipe(db, { status: "live" });
    const noName = await createUser(db, { email: "secret-person@example.com" });
    const longName = await createUser(db, { meta: { full_name: `${"A".repeat(60)} Smith` } });
    const a = await remix(r.id, alice);
    const b = await remix(r.id, noName);
    const c = await remix(r.id, longName);
    const rows = await anonFeed({ recipe: r.id });
    expect(Object.keys(rows[0]).sort()).toEqual(FEED_COLUMNS);
    const byId = new Map(rows.map((x) => [x.id, x]));
    expect(byId.get(a)?.author_name).toBe("Alice");
    expect(byId.get(b)?.author_name).toBe("A home cook");
    const long = byId.get(c)?.author_name ?? "";
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toMatch(/^A+$/);
    // photo_path holds the uid folder by design (plan risk note); no other column may
    const text = JSON.stringify(rows.map(({ photo_path: _photo, ...rest }) => rest));
    for (const secret of [alice, noName, longName, "alice@example.com", "secret-person@example.com", "Wong", "Smith"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("author_name is A home cook when the first word of the name looks like an email", async () => {
    const r = await insertRecipe(db, { status: "live" });
    const cases: [string, string][] = [
      ["jo@x.com Smith", "A home cook"],
      ["jo@x.com", "A home cook"],
      ["@jo", "A home cook"],
      ["  sam@cook.nz  ", "A home cook"],
      ["Priya jo@x.com", "Priya"], // only the first word is used, and it is fine
    ];
    const ids: [string, string, string][] = [];
    for (const [name, expected] of cases) {
      const u = await createUser(db, { meta: { full_name: name } });
      ids.push([await remix(r.id, u), name, expected]);
    }
    const rows = await anonFeed({ recipe: r.id });
    const byId = new Map(rows.map((x) => [x.id, x.author_name]));
    for (const [id, name, expected] of ids) {
      expect({ name, author_name: byId.get(id) }).toEqual({ name, author_name: expected });
    }
    expect(JSON.stringify(rows)).not.toContain("@");
  });

  it("feed limit is clamped to 48", async () => {
    const r = await insertRecipe(db, { status: "live" });
    for (let i = 0; i < 50; i++) await remix(r.id, i % 2 ? alice : bob, "approved", { created_at: minutesAgo(100 - i) });
    expect(await anonFeed({ recipe: r.id, limit: 1000 })).toHaveLength(48);
    expect(await anonFeed({ recipe: r.id, limit: 48 })).toHaveLength(48);
    expect(await anonFeed({ recipe: r.id, limit: 48, offset: 48 })).toHaveLength(2);
    expect(await anonFeed({ recipe: r.id, limit: 10 })).toHaveLength(10);
    expect(await anonFeed({ recipe: r.id, limit: 0 })).toHaveLength(1);
    expect(await anonFeed({ recipe: r.id, limit: -5 })).toHaveLength(1);
  });

  it("anon still cannot select remixes rows directly", async () => {
    const r = await insertRecipe(db, { status: "live" });
    await remix(r.id, alice, "approved");
    const rows = await visibleRows(() => asAnon(db, (tx) => tx.query(`select id from remixes`)));
    expect(rows).toHaveLength(0);
    // and another user still cannot read someone's approved remix row (user_id stays private)
    const seen = await asUser(db, bob, async (tx) => (await tx.query(`select id from remixes where user_id = $1`, [alice])).rows);
    expect(seen).toHaveLength(0);
  });

  it("owner still reads own pending and hidden remixes", async () => {
    const r = await insertRecipe(db, { status: "live" });
    const p = await remix(r.id, alice, "pending");
    const h = await remix(r.id, alice, "hidden");
    const rows = await asUser(db, alice, async (tx) =>
      (await tx.query<{ id: string; status: string }>(`select id, status from remixes where recipe_id = $1 order by status`, [r.id])).rows,
    );
    expect(rows).toEqual([{ id: h, status: "hidden" }, { id: p, status: "pending" }]);
  });

  it("admin reads every remix", async () => {
    const r = await insertRecipe(db, { status: "live" });
    const ids = [await remix(r.id, alice, "pending"), await remix(r.id, bob, "hidden"), await remix(r.id, alice, "approved")];
    const rows = await asAdmin(db, admin, async (tx) =>
      (await tx.query<{ id: string }>(`select id from remixes where recipe_id = $1`, [r.id])).rows,
    );
    expect(rows.map((x) => x.id).sort()).toEqual([...ids].sort());
  });
});
