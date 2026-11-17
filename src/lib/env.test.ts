import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const SELF = resolve(__filename);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [p] : [];
  });
}

// Built from parts so this file does not match itself.
const SECRET_PUBLIC = new RegExp(
  "NEXT_" + "PUBLIC_[A-Z0-9_]*(GEMINI|SERVICE_ROLE|INSTAGRAM|YOUTUBE)",
);

const SERVER_MODULES = [
  ...["gemini-parser", "instagram", "youtube", "run-import"].map((m) => join(SRC, "lib/import", `${m}.ts`)),
  // Ask Shef calls Gemini with GEMINI_API_KEY; run-ask orchestrates it with usage counting
  join(SRC, "lib/ask-shef/ask-shef.ts"),
  join(SRC, "lib/ask-shef/run-ask.ts"),
];

// Server-only modules a client component must never import (types.ts and handle.ts are shared).
const SERVER_IMPORT =
  /from\s+["'](?:@\/lib\/import\/|\.{1,2}\/(?:.*\/)?import\/|@\/lib\/ask-shef\/(?:ask-shef|run-ask)["']|@\/lib\/outside\/add-reel["']|\.{1,2}\/(?:.*\/)?(?:ask-shef\/(?:ask-shef|run-ask)|outside\/add-reel)["'])/;

describe("env and server-only guards", () => {
  it("the client import guard catches the server modules and allows shared ones", () => {
    for (const bad of [
      `import { askShef } from "@/lib/ask-shef/ask-shef";`,
      `import { runAsk } from "@/lib/ask-shef/run-ask";`,
      `import { addReel } from "@/lib/outside/add-reel";`,
      `import { runImport } from "@/lib/import/run-import";`,
      `import { askShef } from "../../lib/ask-shef/ask-shef";`,
    ]) {
      expect({ bad, flagged: SERVER_IMPORT.test(bad) }).toEqual({ bad, flagged: true });
    }
    for (const ok of [
      `import type { AskResult } from "@/lib/ask-shef/types";`,
      `import { reelLabel } from "@/lib/outside/handle";`,
      `import { FREE_LIMITS } from "@/lib/limits";`,
    ]) {
      expect({ ok, flagged: SERVER_IMPORT.test(ok) }).toEqual({ ok, flagged: false });
    }
  });

  it("no NEXT_PUBLIC_ variable names a server secret", () => {
    const files = [join(ROOT, ".env.example"), ...walk(SRC).filter((f) => resolve(f) !== SELF)];
    const offenders = files.filter((f) => SECRET_PUBLIC.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("server modules import 'server-only'", () => {
    const missing = SERVER_MODULES.filter(
      (f) => !/^\s*import\s+["']server-only["'];?\s*$/m.test(readFileSync(f, "utf8")),
    );
    expect(missing.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("no client component imports the import, ask-shef or add-reel server modules or reads server secrets", () => {
    const secretEnv =
      /process\.env\.(GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|INSTAGRAM_ACCESS_TOKEN|YOUTUBE_API_KEY)/;
    const importsServer = SERVER_IMPORT;
    const offenders = walk(SRC)
      .filter((f) => resolve(f) !== SELF)
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        if (!/^\s*["']use client["']/.test(src)) return false;
        return secretEnv.test(src) || importsServer.test(src);
      });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
