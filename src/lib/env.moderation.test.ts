import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Task 3 slice D guards (kept apart from env.test.ts, which slice C's review is extending):
 * - src/lib/remix/moderate.ts (GEMINI_API_KEY), src/lib/supabase/service.ts
 *   (SUPABASE_SERVICE_ROLE_KEY) and src/lib/moderation/queue.ts import "server-only".
 * - No client component imports them, and SUPABASE_SERVICE_ROLE_KEY is read only in service.ts.
 * - .env.example lists SUPABASE_SERVICE_ROLE_KEY= with an empty value, never NEXT_PUBLIC_.
 */

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const SELF = resolve(__filename);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [p] : [];
  });
}
const isTest = (f: string) => /\.test\.(ts|tsx)$/.test(f);

const MODERATION_SERVER_MODULES = [
  join(SRC, "lib/remix/moderate.ts"),
  join(SRC, "lib/supabase/service.ts"),
  join(SRC, "lib/moderation/queue.ts"),
];

const MODERATION_SERVER_IMPORT =
  /from\s+["'](?:@\/lib\/remix\/moderate|@\/lib\/supabase\/service|@\/lib\/moderation\/queue|\.{1,2}\/(?:.*\/)?(?:remix\/moderate|supabase\/service|moderation\/queue)|\.\/(?:moderate|service|queue))["']/;

describe("moderation server-only guards (task 3 slice D)", () => {
  it("the guard pattern catches the moderation modules and allows shared ones", () => {
    for (const bad of [
      `import { moderateRemix } from "@/lib/remix/moderate";`,
      `import { applyAiVerdict } from "@/lib/supabase/service";`,
      `import { loadModerationQueue } from "@/lib/moderation/queue";`,
      `import { moderateRemix } from "../../lib/remix/moderate";`,
      `import { applyAiVerdict } from "./service";`,
    ]) {
      expect({ bad, flagged: MODERATION_SERVER_IMPORT.test(bad) }).toEqual({ bad, flagged: true });
    }
    for (const ok of [
      `import { statusLabel } from "@/lib/remix/status";`,
      `import type { ModerationVerdict } from "@/lib/remix/types";`,
      `import { supabaseConfig } from "@/lib/supabase/config";`,
      `import { createSupabaseBrowserClient } from "@/lib/supabase/client";`,
    ]) {
      expect({ ok, flagged: MODERATION_SERVER_IMPORT.test(ok) }).toEqual({ ok, flagged: false });
    }
  });

  it("moderate.ts, service.ts and queue.ts import 'server-only'", () => {
    const missing = MODERATION_SERVER_MODULES.filter(
      (f) => !/^\s*import\s+["']server-only["'];?\s*$/m.test(readFileSync(f, "utf8")),
    );
    expect(missing.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("no client component imports moderate.ts, service.ts or queue.ts", () => {
    const offenders = walk(SRC)
      .filter((f) => resolve(f) !== SELF)
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return /^\s*["']use client["']/.test(src) && MODERATION_SERVER_IMPORT.test(src);
      });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("SUPABASE_SERVICE_ROLE_KEY is read only in lib/supabase/service.ts", () => {
    const readers = walk(SRC)
      .filter((f) => resolve(f) !== SELF && !isTest(f))
      .filter((f) => /SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(f, "utf8")));
    expect(readers.map((f) => relative(ROOT, f))).toEqual(["src/lib/supabase/service.ts"]);
  });

  it(".env.example lists an empty SUPABASE_SERVICE_ROLE_KEY", () => {
    const env = readFileSync(join(ROOT, ".env.example"), "utf8");
    expect(env).toMatch(/^SUPABASE_SERVICE_ROLE_KEY=\s*$/m);
    expect(env).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE/);
    // every value in the example stays empty except the local site URL
    for (const line of env.split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l))) {
      const [key, value] = [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()];
      if (key === "NEXT_PUBLIC_SITE_URL") continue;
      expect({ key, value }).toEqual({ key, value: "" });
    }
  });
});
