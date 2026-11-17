// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, createDb, createUser, expectBlockedWrite, insertRecipe, makeAdmin,
  uuid, visibleRows, type Tx,
} from "./helpers/db";

/*
 * Slice A outside recipe contract (task 2):
 *   select: source = 'outside' and owner_id = auth.uid() (plus the existing live-shef / admin policy).
 *   insert: source = 'outside', owner_id = auth.uid(), status = 'live', and instagram_id, youtube_id,
 *     youtube_url, cover_image_url all null.
 *   update: none for users. delete: the owner may delete their own outside recipe (decision 1);
 *     deleting does not give the reel back.
 */

let db: PGlite;
let alice: string;
let bob: string;
let admin: string;
let shef: { id: string; slug: string };
let aliceReel: { id: string; slug: string };
let bobReel: { id: string; slug: string };

const REEL = "https://www.instagram.com/reel/C0ffee123/";

type OutsideInsert = {
  slug?: string;
  source?: string;
  status?: string;
  owner_id?: string | null;
  instagram_id?: string | null;
  youtube_id?: string | null;
  youtube_url?: string | null;
  cover_image_url?: string | null;
};

/**
 * The insert the add-reel server action makes with the user's client. Like the action, it spends an
 * outside_reel use first (migration 000005 refuses outside inserts beyond this month's usage count);
 * pass consume: false to skip that (e.g. as anon, or when the test consumes itself).
 */
async function insertOutside(tx: Tx, owner: string, o: OutsideInsert = {}, opts: { consume?: boolean } = {}) {
  if (opts.consume ?? true) await tx.query(`select public.consume_usage('outside_reel', 1000)`);
  const status = o.status ?? "live";
  return tx.query<{ id: string; slug: string }>(
    `insert into recipes (slug, title, source, status, owner_id, published_at, reel_url, ingredients, steps,
                          instagram_id, youtube_id, youtube_url, cover_image_url)
     values ($1, 'Reel pasta', $2::recipe_source, $3::recipe_status, $4, $5, $6,
             '[{"qty":1,"unit":"cup","item":"pasta","note":null}]', '[{"text":"Boil"}]', $7, $8, $9, $10)
     returning id, slug`,
    [
      o.slug ?? `reel-pasta-${uuid().slice(0, 6)}`,
      o.source ?? "outside",
      status,
      o.owner_id === undefined ? owner : o.owner_id,
      status === "live" ? new Date().toISOString() : null,
      REEL,
      o.instagram_id ?? null,
      o.youtube_id ?? null,
      o.youtube_url ?? null,
      o.cover_image_url ?? null,
    ],
  );
}

const slugsAs = (rows: { slug: string }[]) => rows.map((r) => r.slug).sort();

// Fixture outside rows for alice are dated last month, so they do not use up her outside_reel
// allowance for this NZ month (migration 000005) when the tests insert as her.
const EARLIER_MONTH = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db);
  bob = await createUser(db);
  admin = await createUser(db);
  await makeAdmin(db, admin);
  shef = await insertRecipe(db, { slug: "shef-dal", status: "live", source: "shef" });
  aliceReel = await insertRecipe(db, { slug: "reel-alice-abc123", status: "live", source: "outside", owner_id: alice, created_at: EARLIER_MONTH });
  bobReel = await insertRecipe(db, { slug: "reel-bob-def456", status: "live", source: "outside", owner_id: bob });
});

describe("outside recipes RLS", () => {
  it("owner reads own outside recipe", async () => {
    const rows = await asUser(db, alice, async (tx) =>
      (await tx.query<{ slug: string }>(`select slug from recipes where slug = $1`, [aliceReel.slug])).rows,
    );
    expect(rows).toEqual([{ slug: aliceReel.slug }]);
    // and sees only their own outside recipes
    const outside = await asUser(db, alice, async (tx) =>
      (await tx.query<{ slug: string }>(`select slug from recipes where source = 'outside'`)).rows,
    );
    expect(outside.map((r) => r.slug)).not.toContain(bobReel.slug);
    expect(outside.map((r) => r.slug)).toContain(aliceReel.slug);
  });

  it("other users and anon cannot read it", async () => {
    const bobSees = await asUser(db, bob, async (tx) => (await tx.query(`select id from recipes where id = $1`, [aliceReel.id])).rows);
    expect(bobSees).toHaveLength(0);
    const anonSees = await visibleRows(() => asAnon(db, (tx) => tx.query(`select id from recipes where source = 'outside'`)));
    expect(anonSees).toHaveLength(0);
    // a draft outside row (seeded by the server) is not visible to other users either
    const draft = await insertRecipe(db, { status: "draft", source: "outside", owner_id: alice, created_at: EARLIER_MONTH });
    const bobDraft = await asUser(db, bob, async (tx) => (await tx.query(`select id from recipes where id = $1`, [draft.id])).rows);
    expect(bobDraft).toHaveLength(0);
    // an ownerless outside recipe is visible to nobody but admins
    const orphan = await insertRecipe(db, { status: "live", source: "outside", owner_id: null });
    for (const u of [alice, bob]) {
      const seen = await asUser(db, u, async (tx) => (await tx.query(`select id from recipes where id = $1`, [orphan.id])).rows);
      expect(seen).toHaveLength(0);
    }
  });

  it("admin reads all outside recipes", async () => {
    const rows = await asAdmin(db, admin, async (tx) =>
      (await tx.query<{ slug: string }>(`select slug from recipes where source = 'outside' and slug in ($1, $2)`, [aliceReel.slug, bobReel.slug])).rows,
    );
    expect(slugsAs(rows)).toEqual([aliceReel.slug, bobReel.slug].sort());
  });

  it("user inserts a live outside recipe owned by themselves", async () => {
    const created = await asUser(db, alice, async (tx) => (await insertOutside(tx, alice, { slug: "reel-pasta-aaa111" })).rows[0]);
    expect(created.slug).toBe("reel-pasta-aaa111");
    expect(await asSuper(db, `select source, status, owner_id, reel_url from recipes where id = $1`, [created.id])).toEqual([
      { source: "outside", status: "live", owner_id: alice, reel_url: REEL },
    ]);
    // the owner reads it back, nobody else does
    const own = await asUser(db, alice, async (tx) => (await tx.query(`select id from recipes where id = $1`, [created.id])).rows);
    expect(own).toHaveLength(1);
    const other = await asUser(db, bob, async (tx) => (await tx.query(`select id from recipes where id = $1`, [created.id])).rows);
    expect(other).toHaveLength(0);
  });

  it("user cannot insert a shef recipe, a draft, or one owned by someone else", async () => {
    const tries: OutsideInsert[] = [
      { slug: "reel-bad-shef01", source: "shef" },
      { slug: "reel-bad-shef02", source: "shef", owner_id: null },
      { slug: "reel-bad-draft1", status: "draft" },
      { slug: "reel-bad-other1", owner_id: bob },
      { slug: "reel-bad-nobody", owner_id: null },
    ];
    for (const t of tries) {
      await expect(asUser(db, alice, (tx) => insertOutside(tx, alice, t))).rejects.toThrow();
    }
    // control: the same insert as a live outside recipe owned by alice is allowed
    await asUser(db, alice, (tx) => insertOutside(tx, alice, { slug: "reel-ok-control1" }));
    // anon cannot insert anything
    await expect(asAnon(db, (tx) => insertOutside(tx, alice, { slug: "reel-bad-anon01" }, { consume: false }))).rejects.toThrow();
    expect(await asSuper(db, `select slug from recipes where slug like 'reel-bad-%'`)).toHaveLength(0);
  });

  it("user cannot set instagram_id, youtube_id, youtube_url or cover_image_url", async () => {
    const tries: OutsideInsert[] = [
      { slug: "reel-bad-insta1", instagram_id: "C0ffee123" },
      { slug: "reel-bad-ytid01", youtube_id: "dQw4w9WgXcQ" },
      { slug: "reel-bad-yturl1", youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      { slug: "reel-bad-cover1", cover_image_url: "https://example.com/cover.jpg" },
    ];
    for (const t of tries) {
      await expect(asUser(db, alice, (tx) => insertOutside(tx, alice, t))).rejects.toThrow();
    }
    // control: without those columns the insert is allowed
    await asUser(db, alice, (tx) => insertOutside(tx, alice, { slug: "reel-ok-control2" }));
    expect(await asSuper(db, `select slug from recipes where slug like 'reel-bad-%'`)).toHaveLength(0);
  });

  it("owner cannot update an outside recipe", async () => {
    const before = await asSuper(db, `select title, status, source, owner_id, instagram_id from recipes where id = $1`, [aliceReel.id]);
    for (const sql of [
      `update recipes set title = 'Edited' where id = $1`,
      `update recipes set source = 'shef' where id = $1`,
      `update recipes set status = 'draft' where id = $1`,
      `update recipes set instagram_id = 'stolen' where id = $1`,
    ]) {
      await expectBlockedWrite(() => asUser(db, alice, (tx) => tx.query(sql, [aliceReel.id])));
    }
    // and cannot hand it to someone else
    await expectBlockedWrite(() =>
      asUser(db, alice, (tx) => tx.query(`update recipes set owner_id = $2 where id = $1`, [aliceReel.id, bob])),
    );
    expect(await asSuper(db, `select title, status, source, owner_id, instagram_id from recipes where id = $1`, [aliceReel.id])).toEqual(before);
  });

  it("owner deletes own outside recipe; other users and anon cannot", async () => {
    const mine = await insertRecipe(db, { slug: "reel-delete-me1", status: "live", source: "outside", owner_id: alice, created_at: EARLIER_MONTH });
    await expectBlockedWrite(() => asUser(db, bob, (tx) => tx.query(`delete from recipes where id = $1`, [mine.id])));
    await expectBlockedWrite(() => asAnon(db, (tx) => tx.query(`delete from recipes where id = $1`, [mine.id])));
    expect(await asSuper(db, `select id from recipes where id = $1`, [mine.id])).toHaveLength(1);
    // owner can delete their outside recipe, but never a shef recipe
    await expectBlockedWrite(() => asUser(db, alice, (tx) => tx.query(`delete from recipes where id = $1`, [shef.id])));
    expect(await asSuper(db, `select id from recipes where id = $1`, [shef.id])).toHaveLength(1);
    const del = await asUser(db, alice, (tx) => tx.query(`delete from recipes where id = $1`, [mine.id]));
    expect(del.affectedRows).toBe(1);
    expect(await asSuper(db, `select id from recipes where id = $1`, [mine.id])).toHaveLength(0);
  });

  it("deleting an outside recipe does not give the reel back", async () => {
    const carol = await createUser(db);
    const left = await asUser(db, carol, async (tx) => {
      const r = (await tx.query<{ r: number }>(`select public.consume_usage('outside_reel', 5) as r`)).rows[0].r;
      await insertOutside(tx, carol, { slug: "reel-carol-ccc111" }, { consume: false });
      return r;
    });
    expect(left).toBe(4);
    const del = await asUser(db, carol, (tx) => tx.query(`delete from recipes where slug = 'reel-carol-ccc111'`));
    expect(del.affectedRows).toBe(1);
    const after = await asUser(db, carol, async (tx) =>
      (await tx.query<{ r: number }>(`select public.usage_remaining('outside_reel', 5) as r`)).rows[0].r,
    );
    expect(after).toBe(4);
  });

  it("public listing query returns no outside recipes", async () => {
    // the same filter listRecipes uses (status = live, source = shef), run by each kind of viewer
    const listing = `select slug from recipes where status = 'live' and source = 'shef' order by slug`;
    for (const run of [
      () => asAnon(db, async (tx) => (await tx.query<{ slug: string }>(listing)).rows),
      () => asUser(db, alice, async (tx) => (await tx.query<{ slug: string }>(listing)).rows),
      () => asAdmin(db, admin, async (tx) => (await tx.query<{ slug: string }>(listing)).rows),
    ]) {
      const slugs = (await run()).map((r) => r.slug);
      expect(slugs).toContain(shef.slug);
      expect(slugs.filter((s) => s.startsWith("reel-"))).toEqual([]);
    }
    // even without the source filter, anon sees no outside recipes
    const anonAll = await asAnon(db, async (tx) => (await tx.query<{ source: string }>(`select source from recipes`)).rows);
    expect(anonAll.every((r) => r.source === "shef")).toBe(true);
  });

  it("owner can save their own outside recipe", async () => {
    const save = await asUser(db, alice, async (tx) =>
      (await tx.query<{ user_id: string }>(`insert into saves (recipe_id) values ($1) returning user_id`, [aliceReel.id])).rows[0],
    );
    expect(save.user_id).toBe(alice);
  });

  it("other user cannot save someone else's outside recipe", async () => {
    await expect(
      asUser(db, bob, (tx) => tx.query(`insert into saves (recipe_id) values ($1)`, [aliceReel.id])),
    ).rejects.toThrow();
    // nor move an existing save onto it
    const [save] = await asSuper<{ id: string }>(db, `insert into saves (user_id, recipe_id) values ($1, $2) returning id`, [bob, shef.id]);
    await expect(
      asUser(db, bob, (tx) => tx.query(`update saves set recipe_id = $2 where id = $1`, [save.id, aliceReel.id])),
    ).rejects.toThrow();
    expect(await asSuper(db, `select user_id from saves where recipe_id = $1`, [aliceReel.id])).toEqual([{ user_id: alice }]);
  });
});
