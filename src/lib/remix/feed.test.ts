import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
import { loadOwnRemixes, loadRemixFeed, statusLabel } from "./feed";
import type { RemixFeedRow } from "./types";

/*
 * Contract (src/lib/remix/feed.ts, server side):
 *   loadRemixFeed(supabase, { recipeId?, challengeId?, sort?, page? }) -> { cards, page, hasMore }
 *   - calls supabase.rpc("remix_feed", { p_recipe_id, p_challenge_id, p_sort, p_limit, p_offset })
 *     (the slice A function). Ids that are not uuids become null; sort is "likes" or "newest";
 *     page is a whole number >= 1 (else 1); 24 cards a page, p_offset = (page - 1) * 24.
 *   - maps rows to RemixCardData in the order the feed gave them, like_count as a number, an empty
 *     author_name as "A home cook", photos signed with the SAME client (signRemixPhotos, 1 hour).
 *   - a feed error gives no cards (never breaks the page).
 *   loadOwnRemixes(supabase, userId, recipeId) -> the viewer's own remixes of that recipe, any
 *     status, read from `remixes` through their session, filtered by recipe_id and user_id.
 *   statusLabel: approved "Live", pending "Waiting for a quick check", hidden "Hidden".
 */

const R = "11111111-1111-4111-8111-111111111111";
const CH = "22222222-2222-4222-8222-222222222222";
const USER = "b0000000-0000-4000-8000-000000000002";

const feedRow = (i: number, over: Partial<RemixFeedRow> = {}): RemixFeedRow => ({
  id: `r${i}`,
  recipe_id: R,
  recipe_slug: "masala-chai",
  recipe_title: "Masala Chai",
  challenge_id: null,
  changes: `change ${i}`,
  photo_path: `${USER}/0f8fad5b-d9cb-469f-a165-7086772895${String(i).padStart(2, "0")}.jpg`,
  author_name: "Priya",
  like_count: i,
  created_at: `2026-11-${String(10 + (i % 18)).padStart(2, "0")}T00:00:00Z`,
  ...over,
});

function fake(opts: { rows?: unknown[] | null; rpcError?: { message: string } | null; tableRows?: unknown[] } = {}) {
  const rpc = vi.fn(async (_fn: string, _args?: Record<string, unknown>) => ({
    data: opts.rpcError ? null : (opts.rows ?? []),
    error: opts.rpcError ?? null,
  }));
  const createSignedUrls = vi.fn(async (paths: string[], expiresIn: number) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}?e=${expiresIn}`, error: null })),
    error: null,
  }));
  const storageFrom = vi.fn((_bucket: string) => ({ createSignedUrls }));
  const reads: { table: string; filters: [string, string, unknown][] }[] = [];
  const from = vi.fn((table: string) => {
    const read = { table, filters: [] as [string, string, unknown][] };
    reads.push(read);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "range"]) b[m] = vi.fn(() => b);
    for (const f of ["eq", "neq", "in", "is", "match", "filter"]) {
      b[f] = vi.fn((col: string, val?: unknown) => {
        read.filters.push([f, col, val]);
        return b;
      });
    }
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: opts.tableRows ?? [], error: null }).then(res, rej);
    return b;
  });
  const supabase = { rpc, from, storage: { from: storageFrom } } as unknown as SupabaseClient;
  return { supabase, rpc, from, reads, storageFrom, createSignedUrls };
}

describe("remix feed", () => {
  it("loadRemixFeed calls remix_feed with validated filters and page", async () => {
    const f = fake();
    await loadRemixFeed(f.supabase, { recipeId: R, challengeId: CH, sort: "likes", page: 3 });
    expect(f.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = f.rpc.mock.calls[0];
    expect(fn).toBe("remix_feed");
    expect(Object.keys(args!).sort()).toEqual(["p_challenge_id", "p_limit", "p_offset", "p_recipe_id", "p_sort"]);
    expect(args).toMatchObject({ p_recipe_id: R, p_challenge_id: CH, p_sort: "likes", p_offset: 48 });
    // 24 a page (one extra may be asked for to know there is a next page)
    expect([24, 25]).toContain(args!.p_limit);

    // defaults: everything approved, newest first, page 1
    const d = fake();
    await loadRemixFeed(d.supabase);
    expect(d.rpc.mock.calls[0][1]).toMatchObject({ p_recipe_id: null, p_challenge_id: null, p_sort: "newest", p_offset: 0 });

    // bad input never reaches the database as-is
    for (const [opts, expected] of [
      [{ recipeId: "not-a-uuid" }, { p_recipe_id: null }],
      [{ recipeId: "' or 1=1 --" }, { p_recipe_id: null }],
      [{ challengeId: "123" }, { p_challenge_id: null }],
      [{ sort: "random()" }, { p_sort: "newest" }],
      [{ sort: "LIKES" }, { p_sort: "newest" }],
      [{ page: "abc" }, { p_offset: 0 }],
      [{ page: 0 }, { p_offset: 0 }],
      [{ page: -2 }, { p_offset: 0 }],
      [{ page: 1.5 }, { p_offset: 0 }],
      [{ page: "2" }, { p_offset: 24 }],
    ] as const) {
      const g = fake();
      await loadRemixFeed(g.supabase, opts);
      expect({ opts, args: g.rpc.mock.calls[0][1] }).toEqual({ opts, args: expect.objectContaining(expected) });
    }
  });

  it("maps rows to cards with signed URLs and the A home cook fallback", async () => {
    const rows = [
      feedRow(1, { author_name: "Priya", like_count: "3" }),
      feedRow(2, { author_name: "", like_count: 0 }),
      feedRow(3, { author_name: null, like_count: 12 }),
    ];
    const f = fake({ rows });
    const page = await loadRemixFeed(f.supabase, { recipeId: R });
    expect(page.cards.map((c) => c.id)).toEqual(["r1", "r2", "r3"]); // the feed's order is kept
    expect(page.cards[0]).toMatchObject({
      id: "r1",
      recipeId: R,
      recipeSlug: "masala-chai",
      recipeTitle: "Masala Chai",
      challengeId: null,
      changes: "change 1",
      authorName: "Priya",
      likeCount: 3,
      createdAt: rows[0].created_at,
      photoUrl: `https://signed.example/${rows[0].photo_path}?e=3600`,
    });
    expect(page.cards[1].authorName).toBe("A home cook");
    expect(page.cards[2].authorName).toBe("A home cook");
    expect(page.cards.map((c) => c.likeCount)).toEqual([3, 0, 12]);
    // photos are signed in one call, with the same client, from remix-photos
    expect(f.storageFrom).toHaveBeenCalledWith("remix-photos");
    expect(f.createSignedUrls).toHaveBeenCalledTimes(1);
    // cards never carry user ids or emails
    for (const card of page.cards) {
      expect(card).not.toHaveProperty("user_id");
      expect(card).not.toHaveProperty("userId");
      expect(card).not.toHaveProperty("email");
    }
    expect(page).toMatchObject({ page: 1, hasMore: false });

    // a full page plus one means there is more
    const many = fake({ rows: Array.from({ length: 25 }, (_, i) => feedRow(i)) });
    const first = await loadRemixFeed(many.supabase, { page: 1 });
    expect(first.cards.length).toBeLessThanOrEqual(24);
    expect(first.hasMore).toBe(true);

    // a feed error gives an empty page instead of breaking the page
    const broken = fake({ rpcError: { message: "function remix_feed does not exist" } });
    await expect(loadRemixFeed(broken.supabase, { recipeId: R })).resolves.toMatchObject({ cards: [], hasMore: false });
  });

  it("loadOwnRemixes reads the viewer's remixes for a recipe through their session", async () => {
    const own = [
      { id: "o1", recipe_id: R, user_id: USER, status: "pending", changes: "mine", photo_path: `${USER}/a.jpg`, created_at: "2026-11-18T01:00:00Z", challenge_id: null },
      { id: "o2", recipe_id: R, user_id: USER, status: "hidden", changes: "mine too", photo_path: `${USER}/b.jpg`, created_at: "2026-11-17T01:00:00Z", challenge_id: null },
    ];
    const f = fake({ tableRows: own });
    const cards = await loadOwnRemixes(f.supabase, USER, R);
    expect(f.from).toHaveBeenCalledWith("remixes");
    const read = f.reads.find((r) => r.table === "remixes")!;
    expect(read.filters).toEqual(expect.arrayContaining([["eq", "recipe_id", R], ["eq", "user_id", USER]]));
    expect(f.rpc).not.toHaveBeenCalled(); // own rows, not the public feed
    expect(cards.map((c) => [c.id, c.status, c.changes])).toEqual([
      ["o1", "pending", "mine"],
      ["o2", "hidden", "mine too"],
    ]);
    // even pending photos are signed for the owner, with their own session
    expect(f.storageFrom).toHaveBeenCalledWith("remix-photos");
    expect(cards[0].photoUrl).toBe(`https://signed.example/${USER}/a.jpg?e=3600`);
    for (const c of cards) expect(c).not.toHaveProperty("user_id");
  });

  it("statusLabel gives Live, Waiting for a quick check and Hidden", () => {
    expect(statusLabel("approved")).toBe("Live");
    expect(statusLabel("pending")).toBe("Waiting for a quick check");
    expect(statusLabel("hidden")).toBe("Hidden");
  });
});
