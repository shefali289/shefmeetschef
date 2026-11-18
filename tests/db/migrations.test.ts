// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, applyMigrationsFrom, createDb, migrationFiles } from "./helpers/db";

// Task 1 migrations are frozen: new behaviour goes in new files (append-only).
const TASK_1_SHA256: Record<string, string> = {
  "20261117000001_schema.sql": "55006de2d0a3b026c68fdbb8d6e822d97d5082f88da9ddf278611b8e129ee42c",
  "20261117000002_rls.sql": "060e2696a03a5bb8d2fa2ec0a987a1ff903577fef62e59b8d9773520a4b966ac",
  "20261117000003_profile_trigger.sql": "6a6a5c6391f8876ad5b113d1c8d0885da28c3100ade4c8a6ef995a747c43c21c",
  "20261117000004_storage.sql": "a329321d3b4b1342c3b3a3c5afd464a38bbb5f0efea0c4a96676833c97a414a5",
  "20261117000005_import_skips.sql": "7aa78e80bac136ab6718b8f94510aec3cf23cb95000120bc62511c4d13c3cfae",
};

// Task 2, slice A. The enum value has its own file: ALTER TYPE ... ADD VALUE cannot be used in the
// same transaction that adds it.
const TASK_2_FILES = [
  "20261118000001_usage_outside_reel.sql",
  "20261118000002_usage_functions.sql",
  "20261118000003_outside_recipes_rls.sql",
  "20261118000004_cookbook_limits.sql",
  "20261118000005_outside_hardening.sql",
];

// Task 2 migrations are frozen too (task 3 adds new files only).
const TASK_2_SHA256: Record<string, string> = {
  "20261118000001_usage_outside_reel.sql": "d4d72cebf296c3ac265860762eddadeb347e18fea67d533336d8fee59941e7aa",
  "20261118000002_usage_functions.sql": "3fb975348695190179138f35f76c6fcf5a032bde3613b114e6f40b560262cd93",
  "20261118000003_outside_recipes_rls.sql": "8e4e57ac7e5281c15e35a9b75653be711add21ff13e860994976bcb4ff8b30f1",
  "20261118000004_cookbook_limits.sql": "a9329d4d79025488c327e9e7162d295d6cb34500581899bfdb7d2834d598a5b9",
  "20261118000005_outside_hardening.sql": "a40d12f84b42ab6fbcda280d52e3c14a23734de5bfe88866dd6f4e391da53703",
  "20261118000006_usage_caps.sql": "4c1dcd507615a90ba30456f9e32d8cb9453139e78152f9a5af5dfc597afcf220",
};

// Task 3, slice A.
const TASK_3_A_FILES = [
  "20261119000001_remix_usage.sql",
  "20261119000002_bans.sql",
  "20261119000003_remixes_rules.sql",
  "20261119000004_likes_rules.sql",
  "20261119000005_remix_photos_storage.sql",
];

const TABLES = ["profiles", "recipes", "folders", "saves", "remixes", "likes", "challenges", "usage", "bans"];

describe("migrations", () => {
  it("applies all migrations in order", async () => {
    const files = migrationFiles();
    // schema, rls, profile trigger, storage
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) expect(f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect([...files].sort()).toEqual(files);
    await expect(createDb()).resolves.toBeDefined();
  });

  it("task 1 migrations are unchanged (append-only)", () => {
    for (const [file, sha] of Object.entries(TASK_1_SHA256)) {
      const actual = createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, file))).digest("hex");
      expect({ file, sha256: actual }).toEqual({ file, sha256: sha });
    }
    // every later migration sorts after the task 1 files
    const files = migrationFiles();
    expect(files.slice(0, 5)).toEqual(Object.keys(TASK_1_SHA256));
  });

  it("all migrations apply in order", async () => {
    const files = migrationFiles();
    for (const f of TASK_2_FILES) expect(files).toContain(f);
    expect(files.indexOf(TASK_2_FILES[0])).toBeGreaterThan(files.indexOf("20261117000005_import_skips.sql"));
    expect(TASK_2_FILES.map((f) => files.indexOf(f))).toEqual(
      [...TASK_2_FILES.map((f) => files.indexOf(f))].sort((a, b) => a - b),
    );
    await expect(createDb()).resolves.toBeDefined();
    // stopping before a migration and applying the rest gives the same result
    const db = await createDb({ until: "20261118000001" });
    expect(
      (await db.query(`select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                       where t.typname = 'usage_kind' and e.enumlabel = 'outside_reel'`)).rows,
    ).toHaveLength(0);
    await expect(applyMigrationsFrom(db, "20261118000001")).resolves.toBeUndefined();
  });

  it("task 2 migrations are unchanged (append-only)", () => {
    for (const [file, sha] of Object.entries(TASK_2_SHA256)) {
      const actual = createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, file))).digest("hex");
      expect({ file, sha256: actual }).toEqual({ file, sha256: sha });
    }
    // task 2 files come straight after task 1, in order
    expect(migrationFiles().slice(5, 11)).toEqual(Object.keys(TASK_2_SHA256));
  });

  it("task 3 migrations apply in order after 20261118000006", async () => {
    const files = migrationFiles();
    for (const f of TASK_3_A_FILES) expect(files).toContain(f);
    const last2 = files.indexOf("20261118000006_usage_caps.sql");
    const idx = TASK_3_A_FILES.map((f) => files.indexOf(f));
    expect(idx[0]).toBeGreaterThan(last2);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));

    // a project at the end of task 2 upgrades cleanly
    const db = await createDb({ until: "20261119000001" });
    expect((await db.query(`select to_regclass('public.bans') as t`)).rows).toEqual([{ t: null }]);
    expect((await db.query(`select public.usage_cap('remix') as cap`)).rows).toEqual([{ cap: null }]);
    await expect(applyMigrationsFrom(db, "20261119000001")).resolves.toBeUndefined();
    expect((await db.query(`select to_regclass('public.bans')::text as t`)).rows).toEqual([{ t: "bans" }]);
    expect((await db.query(`select public.usage_cap('remix') as cap`)).rows).toEqual([{ cap: 5 }]);
    await db.close();
  });

  it("every security definer function pins search_path, has no PUBLIC execute and anon runs only the allow-list", async () => {
    // Functions anon legitimately needs: is_admin (called by policies anon evaluates, task 1),
    // remix_feed (public remix reads) and remix_photo_is_public (the remix-photos read rule).
    // consume_usage, usage_remaining, is_banned and the other remix helpers are signed-in only.
    const ANON_ALLOWED = ["is_admin", "remix_feed", "remix_photo_is_public"].sort();
    const db = await createDb();
    const { rows } = await db.query<{ name: string; sig: string; config: string[] | null; anon: boolean; pub: boolean }>(
      `select p.proname as name, p.oid::regprocedure::text as sig, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
       order by 2`,
    );
    // the sweep really sees the functions it is meant to guard
    for (const f of ["is_admin", "is_banned", "consume_usage", "usage_remaining", "remix_feed", "remix_is_public",
      "remix_photo_is_public", "remix_photo_in_use", "remix_photo_uploads_recent"]) {
      expect(rows.map((r) => r.name)).toContain(f);
    }
    for (const r of rows) {
      expect({ fn: r.sig, search_path: (r.config ?? []).filter((c) => c.startsWith("search_path=")) })
        .toEqual({ fn: r.sig, search_path: [expect.stringMatching(/^search_path=(""|)$/)] });
      expect({ fn: r.sig, public_execute: r.pub }).toEqual({ fn: r.sig, public_execute: false });
    }
    expect(rows.filter((r) => r.anon).map((r) => r.name).sort()).toEqual(ANON_ALLOWED);
  });

  it("trigger functions in public are not executable by anon or authenticated", async () => {
    const db = await createDb();
    const { rows } = await db.query<{ sig: string; anon: boolean; authed: boolean; pub: boolean }>(
      `select p.oid::regprocedure::text as sig,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
       order by 1`,
    );
    expect(rows.map((r) => r.sig)).toContain("remixes_before_insert()");
    for (const r of rows) expect(r).toEqual({ sig: r.sig, anon: false, authed: false, pub: false });
  });

  it("enables RLS on every public table", async () => {
    const db = await createDb();
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')`,
    );
    const names = rows.map((r) => r.relname);
    for (const t of TABLES) expect(names).toContain(t);
    for (const r of rows) expect({ table: r.relname, rls: r.relrowsecurity }).toEqual({ table: r.relname, rls: true });
  });
});
