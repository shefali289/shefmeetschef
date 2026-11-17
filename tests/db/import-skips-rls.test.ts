// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, createDb, createUser, expectBlockedWrite, makeAdmin, visibleRows,
} from "./helpers/db";

/*
 * import_skips: posts the importer should not parse again.
 *   source text check (instagram | youtube), external_id text, reason text check (no_recipe | failed),
 *   created_at timestamptz default now(), unique (source, external_id).
 *   RLS on. Only admins select / insert / delete. Anon and normal users: nothing.
 */
let db: PGlite;
let admin: string;
let alice: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db);
  alice = await createUser(db);
  await makeAdmin(db, admin);
  await asSuper(
    db,
    `insert into public.import_skips (source, external_id, reason) values ('instagram', 'seed-1', 'no_recipe')`,
  );
});

describe("import_skips table", () => {
  it("exists with the expected columns and RLS enabled", async () => {
    const cols = await asSuper<{ column_name: string; data_type: string }>(
      db,
      `select column_name, data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'import_skips'`,
    );
    const names = cols.map((c) => c.column_name);
    for (const c of ["source", "external_id", "reason", "created_at"]) expect(names).toContain(c);
    const rls = await asSuper<{ relrowsecurity: boolean }>(
      db,
      `select relrowsecurity from pg_class where oid = 'public.import_skips'::regclass`,
    );
    expect(rls[0].relrowsecurity).toBe(true);
  });

  it("created_at defaults to now", async () => {
    const rows = await asSuper<{ created_at: Date | null }>(
      db,
      `select created_at from public.import_skips where external_id = 'seed-1'`,
    );
    expect(rows[0].created_at).not.toBeNull();
  });

  it("checks source and reason values", async () => {
    await expect(
      asSuper(db, `insert into public.import_skips (source, external_id, reason) values ('tiktok', 'x1', 'failed')`),
    ).rejects.toThrow();
    await expect(
      asSuper(db, `insert into public.import_skips (source, external_id, reason) values ('youtube', 'x2', 'meh')`),
    ).rejects.toThrow();
    await expect(
      asSuper(db, `insert into public.import_skips (source, external_id, reason) values ('youtube', null, 'failed')`),
    ).rejects.toThrow();
  });

  it("is unique per (source, external_id)", async () => {
    await expect(
      asSuper(db, `insert into public.import_skips (source, external_id, reason) values ('instagram', 'seed-1', 'failed')`),
    ).rejects.toThrow();
    // same id on the other source is fine
    await asSuper(db, `insert into public.import_skips (source, external_id, reason) values ('youtube', 'seed-1', 'failed')`);
  });

  it("admins can select, insert and delete", async () => {
    const seen = await asAdmin(db, admin, async (tx) =>
      (await tx.query<{ external_id: string }>(`select external_id from import_skips where source = 'instagram'`)).rows,
    );
    expect(seen.map((r) => r.external_id)).toContain("seed-1");
    const ins = await asAdmin(db, admin, (tx) =>
      tx.query(`insert into import_skips (source, external_id, reason) values ('youtube', 'adm-1', 'no_recipe')`),
    );
    expect(ins.affectedRows).toBe(1);
    const del = await asAdmin(db, admin, (tx) => tx.query(`delete from import_skips where external_id = 'adm-1'`));
    expect(del.affectedRows).toBe(1);
  });

  it("normal users see nothing and cannot write", async () => {
    const seen = await visibleRows(() => asUser(db, alice, (tx) => tx.query(`select * from import_skips`)));
    expect(seen).toHaveLength(0);
    await expect(
      asUser(db, alice, (tx) =>
        tx.query(`insert into import_skips (source, external_id, reason) values ('instagram', 'u-1', 'failed')`),
      ),
    ).rejects.toThrow();
    await expectBlockedWrite(() => asUser(db, alice, (tx) => tx.query(`delete from import_skips`)));
    await expectBlockedWrite(() =>
      asUser(db, alice, (tx) => tx.query(`update import_skips set reason = 'failed'`)),
    );
    const left = await asSuper(db, `select 1 from public.import_skips where external_id = 'seed-1' and source = 'instagram'`);
    expect(left).toHaveLength(1);
  });

  it("anon sees nothing and cannot write", async () => {
    const seen = await visibleRows(() => asAnon(db, (tx) => tx.query(`select * from import_skips`)));
    expect(seen).toHaveLength(0);
    await expect(
      asAnon(db, (tx) =>
        tx.query(`insert into import_skips (source, external_id, reason) values ('instagram', 'a-1', 'failed')`),
      ),
    ).rejects.toThrow();
    await expectBlockedWrite(() => asAnon(db, (tx) => tx.query(`delete from import_skips`)));
    const left = await asSuper(db, `select 1 from public.import_skips where external_id = 'seed-1' and source = 'instagram'`);
    expect(left).toHaveLength(1);
  });
});
