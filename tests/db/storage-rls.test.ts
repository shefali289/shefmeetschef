// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, createDb, createUser, expectBlockedWrite, makeAdmin, visibleRows,
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
