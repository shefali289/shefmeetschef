// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, banUser, createDb, createUser, expectBlockedWrite, insertRecipe, makeAdmin, pgErrorOf, seedRemix,
  uploadObject, uuid, visibleRows, type RemixStatus,
} from "./helpers/db";

const BUCKETS = ["drafts", "recipe-images", "remix-photos"];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

let db: PGlite;
let alice: string;
let bob: string;
let admin: string;

const upload = (bucket: string, name: string) =>
  `insert into storage.objects (bucket_id, name) values ('${bucket}', '${name}')`;

async function seedObject(bucket: string, name: string, owner: string | null = null) {
  const [row] = await asSuper<{ id: string }>(
    db,
    `insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3) returning id`,
    [bucket, name, owner],
  );
  return row.id;
}

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db);
  bob = await createUser(db);
  admin = await createUser(db);
  await makeAdmin(db, admin);
});

describe("storage RLS", () => {
  it("creates three buckets with correct public flag", async () => {
    const rows = await asSuper<{ id: string; public: boolean }>(
      db,
      `select id, public from storage.buckets where id in ('recipe-images', 'remix-photos', 'drafts') order by id`,
    );
    expect(rows).toEqual([
      { id: "drafts", public: false },
      { id: "recipe-images", public: true },
      { id: "remix-photos", public: false },
    ]);
  });

  it("every bucket has a 5 MB limit and image mime types only", async () => {
    const rows = await asSuper<{ id: string; file_size_limit: number | string | null; allowed_mime_types: string[] | null }>(
      db,
      `select id, file_size_limit, allowed_mime_types from storage.buckets where id = any($1) order by id`,
      [BUCKETS],
    );
    expect(rows.map((r) => r.id)).toEqual(BUCKETS);
    for (const r of rows) {
      expect({ id: r.id, limit: Number(r.file_size_limit) }).toEqual({ id: r.id, limit: 5242880 });
      expect({ id: r.id, types: [...(r.allowed_mime_types ?? [])].sort() }).toEqual({ id: r.id, types: IMAGE_TYPES });
    }
  });

  it("storage migration fixes a pre-existing bucket", async () => {
    const pre = await createDb({
      beforeMigrations: `insert into storage.buckets (id, name, public) values ('drafts', 'drafts', true), ('remix-photos', 'old', true)`,
    });
    const { rows } = await pre.query<{ id: string; public: boolean; file_size_limit: number | string | null; allowed_mime_types: string[] | null }>(
      `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id in ('drafts', 'remix-photos') order by id`,
    );
    for (const r of rows) {
      expect({ id: r.id, public: r.public, limit: Number(r.file_size_limit), types: [...(r.allowed_mime_types ?? [])].sort() })
        .toEqual({ id: r.id, public: false, limit: 5242880, types: IMAGE_TYPES });
    }
    expect(rows).toHaveLength(2);
    await pre.close();
  });

  it("anon cannot list recipe-images objects", async () => {
    const id = await seedObject("recipe-images", "covers/dal.jpg");
    const rows = await visibleRows(() => asAnon(db, (tx) => tx.query(`select id from storage.objects where id = $1`, [id])));
    expect(rows).toHaveLength(0);
    const all = await visibleRows(() => asAnon(db, (tx) => tx.query(`select id from storage.objects where bucket_id = 'recipe-images'`)));
    expect(all).toHaveLength(0);
    const adm = await asAdmin(db, admin, async (tx) => (await tx.query(`select id from storage.objects where id = $1`, [id])).rows);
    expect(adm).toHaveLength(1);
  });

  it("user cannot upload to recipe-images", async () => {
    await expect(asUser(db, alice, (tx) => tx.query(upload("recipe-images", "covers/hack.jpg")))).rejects.toThrow();
    await expect(asUser(db, alice, (tx) => tx.query(upload("recipe-images", `${alice}/hack.jpg`)))).rejects.toThrow();
    await expect(asAnon(db, (tx) => tx.query(upload("recipe-images", "covers/anon.jpg")))).rejects.toThrow();
  });

  it("admin uploads to recipe-images", async () => {
    const res = await asAdmin(db, admin, (tx) => tx.query(upload("recipe-images", "covers/admin.jpg")));
    expect(res.affectedRows).toBe(1);
  });

  it("user uploads only under own uid in remix-photos", async () => {
    const ok = await asUser(db, alice, (tx) => tx.query(upload("remix-photos", `${alice}/dal.jpg`)));
    expect(ok.affectedRows).toBe(1);
    const own = await asUser(db, alice, async (tx) =>
      (await tx.query(`select id from storage.objects where bucket_id = 'remix-photos' and name = $1`, [`${alice}/dal.jpg`])).rows,
    );
    expect(own).toHaveLength(1);
    await expect(asUser(db, alice, (tx) => tx.query(upload("remix-photos", `${bob}/dal.jpg`)))).rejects.toThrow();
    await expect(asUser(db, alice, (tx) => tx.query(upload("remix-photos", "dal.jpg")))).rejects.toThrow();
    // a root-level file named exactly like the uid is not inside the uid folder
    await expect(asUser(db, alice, (tx) => tx.query(upload("remix-photos", alice)))).rejects.toThrow();
    await expect(asAnon(db, (tx) => tx.query(upload("remix-photos", `${alice}/anon.jpg`)))).rejects.toThrow();
  });

  it("other user cannot read a remix photo", async () => {
    const id = await seedObject("remix-photos", `${alice}/secret.jpg`, alice);
    const bobSees = await asUser(db, bob, async (tx) => (await tx.query(`select id from storage.objects where id = $1`, [id])).rows);
    expect(bobSees).toHaveLength(0);
    const anonSees = await visibleRows(() => asAnon(db, (tx) => tx.query(`select id from storage.objects where id = $1`, [id])));
    expect(anonSees).toHaveLength(0);
    const upd = await asUser(db, bob, (tx) => tx.query(`delete from storage.objects where id = $1`, [id]));
    expect(upd.affectedRows).toBe(0);
    expect(await asSuper(db, `select id from storage.objects where id = $1`, [id])).toHaveLength(1);
  });

  it("drafts readable by admin only", async () => {
    const id = await seedObject("drafts", "imports/reel-1.jpg");
    const anon = await visibleRows(() => asAnon(db, (tx) => tx.query(`select id from storage.objects where id = $1`, [id])));
    expect(anon).toHaveLength(0);
    const user = await asUser(db, alice, async (tx) => (await tx.query(`select id from storage.objects where id = $1`, [id])).rows);
    expect(user).toHaveLength(0);
    const adm = await asAdmin(db, admin, async (tx) => (await tx.query(`select id from storage.objects where id = $1`, [id])).rows);
    expect(adm).toHaveLength(1);
    await expect(asUser(db, alice, (tx) => tx.query(upload("drafts", `${alice}/x.jpg`)))).rejects.toThrow();
    const ins = await asAdmin(db, admin, (tx) => tx.query(upload("drafts", "imports/reel-2.jpg")));
    expect(ins.affectedRows).toBe(1);
  });

  it("admin can read remix-photos objects", async () => {
    const id = await seedObject("remix-photos", `${alice}/for-admin.jpg`, alice);
    const rows = await asAdmin(db, admin, async (tx) => (await tx.query(`select id from storage.objects where id = $1`, [id])).rows);
    expect(rows).toHaveLength(1);
  });

  it("user cannot update or delete objects in recipe-images or drafts", async () => {
    const img = await seedObject("recipe-images", "covers/keep.jpg");
    const draft = await seedObject("drafts", "imports/keep.jpg");
    for (const id of [img, draft]) {
      await expectBlockedWrite(() =>
        asUser(db, alice, (tx) => tx.query(`update storage.objects set name = 'covers/pwned.jpg' where id = $1`, [id])),
      );
      await expectBlockedWrite(() => asUser(db, alice, (tx) => tx.query(`delete from storage.objects where id = $1`, [id])));
    }
    const rows = await asSuper<{ name: string }>(db, `select name from storage.objects where id = any($1) order by name`, [[img, draft]]);
    expect(rows).toEqual([{ name: "covers/keep.jpg" }, { name: "imports/keep.jpg" }]);
  });

  it("other user cannot update or rename a remix photo", async () => {
    const id = await seedObject("remix-photos", `${alice}/mine.jpg`, alice);
    await expectBlockedWrite(() =>
      asUser(db, bob, (tx) => tx.query(`update storage.objects set name = $2 where id = $1`, [id, `${bob}/stolen.jpg`])),
    );
    await expectBlockedWrite(() =>
      asUser(db, bob, (tx) => tx.query(`update storage.objects set owner = $2 where id = $1`, [id, bob])),
    );
    // the owner cannot move it into someone else's folder either
    await expect(
      asUser(db, alice, (tx) => tx.query(`update storage.objects set name = $2 where id = $1`, [id, `${bob}/gift.jpg`])),
    ).rejects.toThrow();
    expect(await asSuper(db, `select name, owner from storage.objects where id = $1`, [id])).toEqual([
      { name: `${alice}/mine.jpg`, owner: alice },
    ]);
  });
});

/*
 * Task 3 slice A contract (remix-photos):
 *   shef_remix_photos_public_read: anon and authenticated may select a remix-photos object when
 *   remix_photo_is_public(name) (used by an approved remix of a live Shef recipe whose author is not
 *   banned). Restrictive rules: no update of remix-photos objects (no overwrite or move); no delete
 *   while a remix uses the photo; no upload by banned users or past 20 uploads in 24 hours.
 */
describe("remix photos (task 3)", () => {
  let recipe: { id: string; slug: string };

  beforeAll(async () => {
    recipe = await insertRecipe(db, { status: "live" });
  });

  const photoOf = (owner: string, status: RemixStatus, recipeId = recipe.id) =>
    seedRemix(db, { recipe_id: recipeId, user_id: owner, status }).then((r) => r.photo_path);
  const anonSees = (name: string) =>
    visibleRows(() => asAnon(db, (tx) => tx.query(`select name from storage.objects where bucket_id = 'remix-photos' and name = $1`, [name])));
  const userSees = (uid: string, name: string) =>
    asUser(db, uid, async (tx) =>
      (await tx.query(`select name from storage.objects where bucket_id = 'remix-photos' and name = $1`, [name])).rows,
    );
  const isPublic = async (name: string) =>
    (await asSuper<{ p: boolean }>(db, `select public.remix_photo_is_public($1) as p`, [name]))[0].p;
  const exists = async (name: string) =>
    (await asSuper(db, `select 1 from storage.objects where bucket_id = 'remix-photos' and name = $1`, [name])).length === 1;

  it("anon and other users can read an approved remix photo", async () => {
    const photo = await photoOf(alice, "approved");
    expect(await anonSees(photo)).toEqual([{ name: photo }]);
    expect(await userSees(bob, photo)).toEqual([{ name: photo }]);
    expect(await userSees(alice, photo)).toEqual([{ name: photo }]);
    expect(await isPublic(photo)).toBe(true);
    // reading does not let anyone else write it
    await expectBlockedWrite(() =>
      asUser(db, bob, (tx) => tx.query(`delete from storage.objects where bucket_id = 'remix-photos' and name = $1`, [photo])),
    );
    expect(await exists(photo)).toBe(true);
    const [fn] = await asSuper<{ prosecdef: boolean; proconfig: string[] | null; pub: boolean }>(
      db,
      `select p.prosecdef, p.proconfig,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'remix_photo_is_public'`,
    );
    expect(fn).toMatchObject({ prosecdef: true, pub: false });
    expect(fn.proconfig ?? []).toContainEqual(expect.stringMatching(/^search_path=(""|)$/));
  });

  it("pending, hidden, banned-author and unused remix photos stay private", async () => {
    const dave = await createUser(db);
    const pending = await photoOf(alice, "pending");
    const hidden = await photoOf(alice, "hidden");
    const byBanned = await photoOf(dave, "approved");
    await banUser(db, dave);
    const carol = await createUser(db);
    const unused = await uploadObject(db, carol);
    const gone = await insertRecipe(db, { status: "live" });
    const onGone = await photoOf(alice, "approved", gone.id);
    await asSuper(db, `update recipes set status = 'draft' where id = $1`, [gone.id]);
    for (const name of [pending, hidden, byBanned, unused, onGone]) {
      expect({ name, anon: await anonSees(name) }).toEqual({ name, anon: [] });
      expect({ name, bob: await userSees(bob, name) }).toEqual({ name, bob: [] });
      expect({ name, pub: await isPublic(name) }).toEqual({ name, pub: false });
    }
    // the owner still sees their own photos, the admin sees all (moderation)
    for (const name of [pending, hidden]) expect(await userSees(alice, name)).toHaveLength(1);
    expect(await userSees(carol, unused)).toHaveLength(1);
    for (const name of [pending, hidden, byBanned, unused]) expect(await userSees(admin, name)).toHaveLength(1);
    // the same name in another bucket is not made public by an approved remix
    const approved = await photoOf(alice, "approved");
    await asSuper(db, `insert into storage.objects (bucket_id, name) values ('drafts', $1)`, [approved]);
    const inDrafts = await visibleRows(() =>
      asAnon(db, (tx) => tx.query(`select id from storage.objects where bucket_id = 'drafts' and name = $1`, [approved])),
    );
    expect(inDrafts).toHaveLength(0);
  });

  it("anon listing of remix-photos returns approved photos only", async () => {
    const fresh = await createDb();
    try {
      const u = await createUser(fresh);
      const v = await createUser(fresh);
      const r = await insertRecipe(fresh, { status: "live" });
      const a1 = (await seedRemix(fresh, { recipe_id: r.id, user_id: u, status: "approved" })).photo_path;
      const a2 = (await seedRemix(fresh, { recipe_id: r.id, user_id: v, status: "approved" })).photo_path;
      await seedRemix(fresh, { recipe_id: r.id, user_id: u, status: "pending" });
      await seedRemix(fresh, { recipe_id: r.id, user_id: v, status: "hidden" });
      await uploadObject(fresh, u);
      const listed = await visibleRows(() =>
        asAnon(fresh, (tx) => tx.query<{ name: string }>(`select name from storage.objects where bucket_id = 'remix-photos'`)),
      );
      expect(listed.map((x) => x.name).sort()).toEqual([a1, a2].sort());
      const all = await visibleRows(() => asAnon(fresh, (tx) => tx.query<{ name: string }>(`select name from storage.objects`)));
      expect(all.map((x) => x.name).sort()).toEqual([a1, a2].sort());
    } finally {
      await fresh.close();
    }
  });

  it("owner cannot overwrite or move a remix photo", async () => {
    const owner = await createUser(db);
    const approved = await photoOf(owner, "approved");
    const unused = await uploadObject(db, owner);
    for (const name of [approved, unused]) {
      const changes = [
        `name = '${owner}/${uuid()}.jpg'`, // move within own folder
        `owner = '${owner}'`, // a no-op-looking overwrite (upsert)
        `created_at = now() - interval '2 days'`, // would dodge the 24 hour upload count
      ];
      for (const set of changes) {
        await expectBlockedWrite(() =>
          asUser(db, owner, (tx) => tx.query(`update storage.objects set ${set} where bucket_id = 'remix-photos' and name = $1`, [name])),
        );
      }
      expect(await exists(name)).toBe(true);
    }
    // nothing moved: both objects keep their names and nothing new appeared in the folder
    const names = await asSuper<{ name: string }>(
      db, `select name from storage.objects where bucket_id = 'remix-photos' and name = any($1) order by name`, [[approved, unused]],
    );
    expect(names.map((x) => x.name)).toEqual([approved, unused].sort());
    // the admin's recipe-images writes are untouched by the new rule
    const [img] = await asSuper<{ id: string }>(db, `insert into storage.objects (bucket_id, name) values ('recipe-images', $1) returning id`, [
      `covers/${uuid()}.jpg`,
    ]);
    const upd = await asAdmin(db, admin, (tx) => tx.query(`update storage.objects set name = $2 where id = $1`, [img.id, `covers/${uuid()}.jpg`]));
    expect(upd.affectedRows).toBe(1);
  });

  it("a photo used by a remix cannot be deleted until the remix is deleted", async () => {
    const u = await createUser(db);
    const { id, photo_path } = await seedRemix(db, { recipe_id: recipe.id, user_id: u, status: "pending" });
    await expectBlockedWrite(() =>
      asUser(db, u, (tx) => tx.query(`delete from storage.objects where bucket_id = 'remix-photos' and name = $1`, [photo_path])),
    );
    expect(await exists(photo_path)).toBe(true);
    const inUse = await asSuper<{ used: boolean }>(db, `select public.remix_photo_in_use($1) as used`, [photo_path]);
    expect(inUse).toEqual([{ used: true }]);
    await asUser(db, u, (tx) => tx.query(`delete from remixes where id = $1`, [id]));
    const del = await asUser(db, u, (tx) =>
      tx.query(`delete from storage.objects where bucket_id = 'remix-photos' and name = $1`, [photo_path]),
    );
    expect(del.affectedRows).toBe(1);
    expect(await exists(photo_path)).toBe(false);
    // an unused upload (closed tab) can be cleaned up at once
    const unused = await uploadObject(db, u);
    const del2 = await asUser(db, u, (tx) => tx.query(`delete from storage.objects where bucket_id = 'remix-photos' and name = $1`, [unused]));
    expect(del2.affectedRows).toBe(1);
  });

  it("banned user cannot upload remix photos", async () => {
    const u = await createUser(db);
    await uploadObject(db, u); // fine before the ban
    await banUser(db, u);
    await expect(uploadObject(db, u)).rejects.toThrow();
    const [row] = await asSuper<{ n: number }>(
      db, `select count(*)::int as n from storage.objects where bucket_id = 'remix-photos' and owner = $1`, [u],
    );
    expect(row.n).toBe(1);
    // other users still can
    await expect(uploadObject(db, bob)).resolves.toMatch(new RegExp(`^${bob}/`));
  });

  it("the 21st upload within 24 hours is refused", async () => {
    const u = await createUser(db);
    const other = await createUser(db);
    // older uploads, used by remixes, do not count
    for (let i = 0; i < 5; i++) {
      const name = `${u}/${uuid()}.jpg`;
      await asSuper(
        db,
        `insert into storage.objects (bucket_id, name, owner, created_at) values ('remix-photos', $1, $2, now() - interval '25 hours')`,
        [name, u],
      );
      await seedRemix(db, { recipe_id: recipe.id, user_id: u, photo_path: name, withPhoto: false });
    }
    // 18 recent uploads that remixes use (so the unused-photo limit is not what stops the 21st)
    for (let i = 0; i < 18; i++) await seedRemix(db, { recipe_id: recipe.id, user_id: u });
    await uploadObject(db, u);
    await uploadObject(db, u);
    await expect(uploadObject(db, u)).rejects.toThrow();
    const [row] = await asSuper<{ n: number }>(
      db,
      `select count(*)::int as n from storage.objects where bucket_id = 'remix-photos' and owner = $1 and created_at > now() - interval '24 hours'`,
      [u],
    );
    expect(row.n).toBe(20);
    // the count is per user
    await expect(uploadObject(db, other)).resolves.toMatch(new RegExp(`^${other}/`));
    // other buckets are untouched by the rule
    const res = await asAdmin(db, admin, (tx) => tx.query(upload("drafts", `imports/${uuid()}.jpg`)));
    expect(res.affectedRows).toBe(1);
  });

  it("a sixth unused upload is refused whatever its age, and photos used by remixes do not count", async () => {
    const u = await createUser(db);
    // photos used by remixes, recent and old, do not count toward the unused limit
    for (let i = 0; i < 3; i++) await seedRemix(db, { recipe_id: recipe.id, user_id: u, status: "approved" });
    // unused uploads from days ago still count
    for (let i = 0; i < 3; i++) {
      await asSuper(
        db,
        `insert into storage.objects (bucket_id, name, owner, created_at) values ('remix-photos', $1, $2, now() - interval '3 days')`,
        [`${u}/${uuid()}.jpg`, u],
      );
    }
    const fourth = await uploadObject(db, u);
    await uploadObject(db, u); // fifth unused
    const err = await pgErrorOf(() => uploadObject(db, u));
    expect(err.code).toBe("42501");
    const [row] = await asSuper<{ n: number }>(
      db, `select count(*)::int as n from storage.objects where bucket_id = 'remix-photos' and owner = $1`, [u],
    );
    expect(row.n).toBe(8);
    // posting a remix with one of them frees a slot
    await asUser(db, u, (tx) =>
      tx.query(`insert into remixes (recipe_id, photo_path, changes) values ($1, $2, 'used it')`, [recipe.id, fourth]),
    );
    const freed = await uploadObject(db, u);
    await expect(uploadObject(db, u)).rejects.toThrow();
    // deleting an unused one frees a slot too
    await asUser(db, u, (tx) => tx.query(`delete from storage.objects where bucket_id = 'remix-photos' and name = $1`, [freed]));
    await expect(uploadObject(db, u)).resolves.toMatch(new RegExp(`^${u}/`));
    // the limit is per user: another user's unused photos do not count
    const v = await createUser(db);
    for (let i = 0; i < 5; i++) await uploadObject(db, v);
    await expect(uploadObject(db, v)).rejects.toThrow();
    await expect(uploadObject(db, bob)).resolves.toMatch(new RegExp(`^${bob}/`));
  });

  it("remix_photo_in_use does not reveal whether another user's photo is in use", async () => {
    const owner = await createUser(db);
    const snoop = await createUser(db);
    const used = (await seedRemix(db, { recipe_id: recipe.id, user_id: owner, status: "pending" })).photo_path;
    const unused = await uploadObject(db, owner);
    const inUse = (uid: string, name: string) =>
      asUser(db, uid, async (tx) => (await tx.query<{ used: boolean }>(`select public.remix_photo_in_use($1) as used`, [name])).rows[0].used);
    // the owner and the admin get the real answer
    expect(await inUse(owner, used)).toBe(true);
    expect(await inUse(owner, unused)).toBe(false);
    expect(await inUse(admin, used)).toBe(true);
    // another user learns nothing: false (or an error) for both a used and an unused path
    for (const name of [used, unused, `${owner}/${uuid()}.jpg`]) {
      let answer: boolean | "error";
      try {
        answer = await inUse(snoop, name);
      } catch {
        answer = "error";
      }
      expect({ name, answer: answer === "error" ? false : answer }).toEqual({ name, answer: false });
    }
    // anon cannot ask at all
    const err = await pgErrorOf(() => asAnon(db, (tx) => tx.query(`select public.remix_photo_in_use($1)`, [used])));
    expect(err.code).toBe("42501");
  });

  it("owner cannot upsert over an approved remix photo", async () => {
    const owner = await createUser(db);
    const name = `${owner}/${uuid()}.jpg`;
    await asSuper(
      db,
      `insert into storage.objects (bucket_id, name, owner, metadata) values ('remix-photos', $1, $2, '{"eTag":"original","size":1000}')`,
      [name, owner],
    );
    await seedRemix(db, { recipe_id: recipe.id, user_id: owner, status: "approved", photo_path: name, withPhoto: false });
    // Storage's upsert: insert ... on conflict (bucket_id, name) do update
    const err = await pgErrorOf(() =>
      asUser(db, owner, (tx) =>
        tx.query(
          `insert into storage.objects (bucket_id, name, owner, metadata) values ('remix-photos', $1, $2, '{"eTag":"swapped","size":66}')
           on conflict (bucket_id, name) do update set metadata = excluded.metadata, owner = excluded.owner, created_at = now()`,
          [name, owner],
        ),
      ),
    );
    expect(err.code).toBe("42501");
    // someone else cannot take it over that way either
    const err2 = await pgErrorOf(() =>
      asUser(db, bob, (tx) =>
        tx.query(
          `insert into storage.objects (bucket_id, name, owner, metadata) values ('remix-photos', $1, $2, '{"eTag":"swapped"}')
           on conflict (bucket_id, name) do update set metadata = excluded.metadata, owner = excluded.owner`,
          [name, bob],
        ),
      ),
    );
    expect(err2.code).toBe("42501");
    expect(await asSuper(db, `select owner, metadata from storage.objects where bucket_id = 'remix-photos' and name = $1`, [name])).toEqual([
      { owner, metadata: { eTag: "original", size: 1000 } },
    ]);
  });
});
