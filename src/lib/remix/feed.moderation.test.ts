import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
import { loadOwnRemixes } from "./feed";

/*
 * Task 3 slice D contract (src/lib/remix/feed.ts): loadOwnRemixes also reads hidden_by and
 * ai_reason for the owner's own rows, and each OwnRemixCard carries
 *   hiddenBy: "ai" | "reports" | "admin" | "ban" | null
 *   aiReason: string | null   -- only for a remix hidden by the AI (never for pending or approved)
 * so the owner's card can say "Hidden: <reason>" or "Hidden while Shef takes a look".
 */

const R = "11111111-1111-4111-8111-111111111111";
const USER = "b0000000-0000-4000-8000-000000000002";

function fake(rows: unknown[]) {
  const selects: string[] = [];
  const from = vi.fn((_table: string) => {
    const b: Record<string, unknown> = {};
    b.select = vi.fn((cols: string) => {
      selects.push(cols);
      return b;
    });
    for (const m of ["order", "limit", "range", "eq", "neq", "in", "is", "match", "filter"]) b[m] = vi.fn(() => b);
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res, rej);
    return b;
  });
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}`, error: null })),
    error: null,
  }));
  const supabase = { rpc: vi.fn(), from, storage: { from: vi.fn(() => ({ createSignedUrls })) } } as unknown as SupabaseClient;
  return { supabase, selects };
}

describe("own remixes with moderation details", () => {
  it("loadOwnRemixes carries hidden_by and the AI reason for the owner's hidden remixes", async () => {
    const base = { recipe_id: R, user_id: USER, challenge_id: null, created_at: "2026-11-18T01:00:00Z" };
    const f = fake([
      { ...base, id: "o1", status: "hidden", hidden_by: "ai", ai_verdict: "reject", ai_reason: "Not food", changes: "a", photo_path: `${USER}/a.jpg` },
      { ...base, id: "o2", status: "hidden", hidden_by: "reports", ai_verdict: "approve", ai_reason: "Food", changes: "b", photo_path: `${USER}/b.jpg` },
      { ...base, id: "o3", status: "pending", hidden_by: null, ai_verdict: "review", ai_reason: "Unsure about advice", changes: "c", photo_path: `${USER}/c.jpg` },
      { ...base, id: "o4", status: "approved", hidden_by: null, ai_verdict: "approve", ai_reason: "Food", changes: "d", photo_path: `${USER}/d.jpg` },
    ]);
    const cards = await loadOwnRemixes(f.supabase, USER, R, { slug: "masala-chai", title: "Masala Chai" });
    expect(f.selects.join(",")).toMatch(/hidden_by/);
    expect(f.selects.join(",")).toMatch(/ai_reason/);
    expect(cards.map((c) => [c.id, c.status, c.hiddenBy, c.aiReason])).toEqual([
      ["o1", "hidden", "ai", "Not food"],
      ["o2", "hidden", "reports", null],
      ["o3", "pending", null, null],
      ["o4", "approved", null, null],
    ]);
  });
});
