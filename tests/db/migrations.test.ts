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

const TABLES = ["profiles", "recipes", "folders", "saves", "remixes", "likes", "challenges", "usage"];

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
