import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as lastImport from "./last-import";

/*
 * Contract (new pure helpers in last-import.ts):
 *   encodeLastImport(summary) -> string   cookie value: encodeURIComponent(JSON.stringify(trimmed))
 *   decodeLastImport(raw)     -> decoded | null
 * The decoded value keeps the full counts (imported, skipped, noRecipeCount, failedCount) but at
 * most 3 refs per list, each id capped at 40 chars and url at 200. Ref urls must be https:, so a
 * tampered cookie decodes to null (treated as "no summary").
 */
type Ref = { source: "instagram" | "youtube"; id: string; url: string; error?: string };
type Encode = (v: unknown) => string;
type Decode = (raw: string | undefined) => {
  at: string;
  imported: number;
  skipped: number;
  noRecipeCount: number;
  failedCount: number;
  noRecipe: Ref[];
  failed: Ref[];
  error?: string;
} | null;

const encode = (lastImport as unknown as { encodeLastImport: Encode }).encodeLastImport;
const decode = (lastImport as unknown as { decodeLastImport: Decode }).decodeLastImport;

const longUrl = (i: number) => `https://www.instagram.com/reel/${"x".repeat(400)}${i}/`;
const longId = (i: number) => `${"9".repeat(120)}${i}`;

function worstCase() {
  return {
    at: "2026-11-17T10:00:00.000Z",
    imported: 12,
    skipped: 340,
    remaining: 25,
    noRecipe: Array.from({ length: 50 }, (_, i) => ({ source: "instagram" as const, id: longId(i), url: longUrl(i) })),
    failed: Array.from({ length: 50 }, (_, i) => ({
      source: "youtube" as const,
      id: longId(i),
      url: `https://www.youtube.com/watch?v=${"y".repeat(400)}${i}`,
      error: `Gemini said: ${"é<>\"&%".repeat(60)}`.slice(0, 300),
    })),
    sourceErrors: [{ source: "youtube", error: "q".repeat(500) }],
    error: "z".repeat(1000),
  };
}

describe("last-import cookie", () => {
  it("encoded worst-case value stays under 3500 chars", () => {
    expect(typeof encode).toBe("function");
    const raw = encode(worstCase());
    expect(raw.length).toBeLessThan(3500);
    // it is URI-encoded JSON
    expect(() => JSON.parse(decodeURIComponent(raw))).not.toThrow();
  });

  it("keeps counts, at most 3 refs per list, id capped 40, url capped 200", () => {
    const decoded = decode(encode(worstCase()));
    expect(decoded).not.toBeNull();
    expect(decoded!.imported).toBe(12);
    expect(decoded!.skipped).toBe(340);
    expect(decoded!.noRecipeCount).toBe(50);
    expect(decoded!.failedCount).toBe(50);
    expect(decoded!.noRecipe.length).toBeLessThanOrEqual(3);
    expect(decoded!.failed.length).toBeLessThanOrEqual(3);
    expect(decoded!.noRecipe.length).toBeGreaterThan(0);
    for (const r of [...decoded!.noRecipe, ...decoded!.failed]) {
      expect(r.id.length).toBeLessThanOrEqual(40);
      expect(r.url.length).toBeLessThanOrEqual(200);
      expect(r.url.startsWith("https://")).toBe(true);
    }
  });

  it("round-trips a small summary unchanged", () => {
    const small = {
      at: "2026-11-17T10:00:00.000Z",
      imported: 1,
      skipped: 0,
      noRecipe: [{ source: "instagram" as const, id: "17900", url: "https://www.instagram.com/reel/A/" }],
      failed: [],
    };
    const decoded = decode(encode(small));
    expect(decoded).toMatchObject({
      imported: 1,
      skipped: 0,
      noRecipeCount: 1,
      failedCount: 0,
      noRecipe: small.noRecipe,
      failed: [],
    });
  });

  it("parsing rejects non-https ref urls (tampered cookie is treated as no summary)", () => {
    const good = JSON.parse(decodeURIComponent(encode(worstCase())));
    for (const bad of ["javascript:alert(1)", "http://evil.example/", "//evil.example", "data:text/html,x"]) {
      const tampered = structuredClone(good);
      tampered.noRecipe[0].url = bad;
      expect(decode(encodeURIComponent(JSON.stringify(tampered))), bad).toBeNull();
    }
  });

  it("garbage, non-JSON and missing cookies decode to null", () => {
    expect(decode(undefined)).toBeNull();
    expect(decode("")).toBeNull();
    expect(decode("%E0%A4%A")).toBeNull();
    expect(decode(encodeURIComponent("{not json"))).toBeNull();
    expect(decode(encodeURIComponent(JSON.stringify({ imported: "lots" })))).toBeNull();
  });
});
