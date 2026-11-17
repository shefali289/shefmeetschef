// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createDb, migrationFiles } from "./helpers/db";

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
