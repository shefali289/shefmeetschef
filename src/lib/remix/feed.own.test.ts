import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RemixCardData } from "./types";

vi.mock("server-only", () => ({}));
import * as feed from "./feed";

/*
 * Slice D review B2 contract (src/lib/remix/feed.ts):
 *   markOwn<T extends RemixCardData>(supabase, userId: string | null, cards: T[]): Promise<T[]>
 *   - Reads remixes.select("id").eq("user_id", userId).in("id", <card ids>) with the given
 *     (session) client, one query, and sets mine = true on the cards it returns, mine = false on
 *     the rest. RemixCardData gains `mine?: boolean`; the feed never returns user_id.
 *   - No user (signed out) or no cards: no query, cards returned unchanged.
 *   - A read error (or a throw): cards returned unchanged.
 */

type MarkOwn = <T extends RemixCardData>(supabase: SupabaseClient, userId: string | null, cards: T[]) => Promise<T[]>;
const markOwn = (...args: Parameters<MarkOwn>) => {
  const fn = (feed as unknown as { markOwn?: MarkOwn }).markOwn;
  if (typeof fn !== "function") throw new Error("feed.markOwn is not exported");
  return fn(...args);
};

const USER = "b0000000-0000-4000-8000-000000000002";
const ids = ["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002", "aaaaaaaa-0000-4000-8000-000000000003"];
const card = (id: string): RemixCardData => ({
  id,
  recipeId: "11111111-1111-4111-8111-111111111111",
  recipeSlug: "masala-chai",
  recipeTitle: "Masala Chai",
  challengeId: null,
  changes: "x",
  authorName: "Priya",
  likeCount: 0,
  createdAt: "2026-11-18T01:00:00Z",
  photoUrl: null,
  liked: false,
});

type Call = { table: string; select?: string; eq: [string, unknown][]; in: [string, unknown[]][] };
function fake(result: { data: unknown; error: unknown } | "throw") {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const c: Call = { table, eq: [], in: [] };
    calls.push(c);
    const b: Record<string, unknown> = {};
    b.select = (cols: string) => {
      c.select = cols;
      return b;
    };
    b.eq = (col: string, v: unknown) => {
      c.eq.push([col, v]);
      return b;
    };
    b.in = (col: string, v: unknown[]) => {
      c.in.push([col, v]);
      return b;
    };
    for (const m of ["order", "limit", "match", "filter", "is", "neq"]) b[m] = () => b;
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      (result === "throw" ? Promise.reject(new Error("fetch failed")) : Promise.resolve(result)).then(res, rej);
    return b;
  });
  const rpc = vi.fn();
  return { supabase: { from, rpc } as unknown as SupabaseClient, calls, from, rpc };
}

describe("markOwn", () => {
  it("reads the viewer's own ids among the cards and sets mine on the matching ones", async () => {
    const f = fake({ data: [{ id: ids[1] }], error: null });
    const cards = ids.map(card);
    const out = await markOwn(f.supabase, USER, cards);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toEqual({ table: "remixes", select: "id", eq: [["user_id", USER]], in: [["id", ids]] });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(out.map((c) => [c.id, (c as { mine?: boolean }).mine])).toEqual([
      [ids[0], false],
      [ids[1], true],
      [ids[2], false],
    ]);
    // everything else on the card is unchanged, and no user_id leaks onto it
    expect(out[1]).toMatchObject(cards[1]);
    for (const c of out) expect(c).not.toHaveProperty("user_id");
  });

  it("makes no call for a signed-out viewer or no cards", async () => {
    const f = fake({ data: [{ id: ids[0] }], error: null });
    const cards = ids.map(card);
    await expect(markOwn(f.supabase, null, cards)).resolves.toEqual(cards);
    await expect(markOwn(f.supabase, USER, [])).resolves.toEqual([]);
    expect(f.from).not.toHaveBeenCalled();
  });

  it("returns the cards unchanged on error", async () => {
    const cards = ids.map(card);
    const err = fake({ data: null, error: { message: "boom" } });
    await expect(markOwn(err.supabase, USER, cards)).resolves.toEqual(cards);
    const thrown = fake("throw");
    await expect(markOwn(thrown.supabase, USER, cards)).resolves.toEqual(cards);
  });
});
