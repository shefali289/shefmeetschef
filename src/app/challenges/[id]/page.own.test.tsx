import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Challenge, ChallengeDetail, ChallengeEntry } from "@/lib/challenges/types";

/*
 * Slice D review B2 contract: /challenges/[id] calls markOwn(viewer.supabase, viewer.user.id,
 * entries) from @/lib/remix/feed for a signed-in viewer (with the viewer's own session client,
 * even for the admin), so the viewer's own entries show no Report button. Mocks are copied from
 * page.test.tsx in this folder.
 */

vi.mock("server-only", () => ({}));
const { state, getChallenge, pickWinner, markLiked, markOwn } = vi.hoisted(() => ({
  // B2: marks the viewer's own entries (here: the entry with id starting "2").
  markOwn: vi.fn(async <T extends { id: string }>(_sb: unknown, uid: string | null, cards: T[]): Promise<T[]> =>
    uid ? cards.map((c) => ({ ...c, mine: c.id.startsWith("2") })) : cards,
  ),
  state: { configured: true, admin: false, cook: false, likedIds: [] as string[] },
  // Same shape as the real markLiked (src/lib/remix/feed.ts): marks the viewer's own likes.
  markLiked: vi.fn(async <T extends { id: string; liked: boolean }>(_sb: unknown, _uid: string, cards: T[]): Promise<T[]> =>
    cards.map((c) => ({ ...c, liked: state.likedIds.includes(c.id) })),
  ),
  getChallenge: vi.fn(async (_sb: unknown, _id: string, _o?: { admin?: boolean; today?: string }): Promise<ChallengeDetail | null> => null),
  pickWinner: vi.fn(async () => ({ ok: true })),
}));
const client = { marker: "client" };
const ADMIN = { id: "a0000000-0000-4000-8000-000000000001", email: "shef@example.com" };
const COOK = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const viewerUser = () => (state.admin ? ADMIN : state.cook ? COOK : null);
vi.mock("@/lib/auth/session", () => ({
  getViewer: vi.fn(async () =>
    state.configured
      ? { configured: true, user: viewerUser(), supabase: client }
      : { configured: false, user: null, supabase: null },
  ),
  getCurrentUser: vi.fn(async () => ({ configured: state.configured, user: viewerUser() })),
  adminGate: vi.fn(async () =>
    !state.configured
      ? { state: "not-configured" }
      : state.admin
        ? { state: "admin", user: ADMIN, supabase: client }
        : state.cook
          ? { state: "not-admin", user: COOK }
          : { state: "signed-out" },
  ),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => (state.configured ? client : null)) }));
vi.mock("@supabase/supabase-js", async (orig) => ({
  ...(await orig<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(() => client),
}));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: vi.fn(() => null) }));
vi.mock("@/lib/challenges/challenges", () => ({
  getChallenge,
  getCurrentChallenge: vi.fn(async () => null),
  listChallenges: vi.fn(async () => ({ current: null, past: [] })),
}));
vi.mock("@/lib/remix/feed", async (orig) => ({
  ...(await orig<typeof import("@/lib/remix/feed")>()),
  markLiked,
  markOwn,
}));
vi.mock("@/app/admin/challenges/actions", () => ({ pickWinner, createChallenge: vi.fn() }));
vi.mock("@/app/remixes/report-actions", () => ({ reportRemix: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/app/remixes/actions", () => ({
  toggleLike: vi.fn(async () => ({ ok: true })),
  deleteRemix: vi.fn(async () => ({ ok: true })),
}));
vi.mock("next/image", () => import("@/test/next-image-mock"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (u: string) => {
    throw new Error(`NEXT_REDIRECT ${u}`);
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/challenges/x",
  useSearchParams: () => new URLSearchParams(),
}));

import ChallengePage from "./page";

const ID = "c2c2c2c2-0000-4000-8000-000000000002";

const challenge = (over: Partial<Challenge> = {}): Challenge => ({
  id: ID,
  title: "Chai, your way",
  description: "Swap the milk, the spice, anything.",
  startsOn: "2026-11-16",
  endsOn: "2026-11-22",
  baseRecipeId: "r-chai",
  baseRecipeSlug: "masala-chai",
  baseRecipeTitle: "Masala Chai",
  winnerRemixId: null,
  winner: null,
  ...over,
});

const entry = (n: number, author: string, changes: string, likes: number, isWinner = false): ChallengeEntry => ({
  id: `${String(n).repeat(8)}-1111-4111-8111-111111111111`,
  recipeId: "r-chai",
  recipeSlug: "masala-chai",
  recipeTitle: "Masala Chai",
  challengeId: ID,
  changes,
  authorName: author,
  likeCount: likes,
  createdAt: `2026-11-1${n}T01:00:00Z`,
  photoUrl: `https://signed.example/u${n}.jpg`,
  liked: false,
  isWinner,
});

// Newest first (visitor order) and by likes (admin order).
const NEWEST = [entry(3, "Mia", "Jaggery instead of sugar", 2), entry(2, "Priya", "Oat milk and cardamom", 9), entry(1, "Sam", "Extra ginger", 5)];

function detail(over: Partial<ChallengeDetail> = {}): ChallengeDetail {
  return { challenge: challenge(), entries: NEWEST, sort: "newest", open: true, ended: false, ...over };
}


beforeEach(() => {
  state.configured = true;
  state.admin = false;
  state.cook = false;
  state.likedIds = [];
  markOwn.mockClear();
  getChallenge.mockImplementation(async () => detail());
});

describe("/challenges/[id] marks the viewer's own entries", () => {
  it("signed in: markOwn runs with the viewer's id and their own entry has no Report button", async () => {
    state.cook = true;
    render(await ChallengePage({ params: Promise.resolve({ id: ID }) }));
    expect(markOwn).toHaveBeenCalledTimes(1);
    const [sb, uid, cards] = markOwn.mock.calls[0];
    expect(sb).toBe(client);
    expect(uid).toBe(COOK.id);
    expect((cards as { id: string }[]).map((c) => c.id).sort()).toEqual(NEWEST.map((e) => e.id).sort());
    // entry 2 (Priya) is the viewer's own
    expect(screen.queryByRole("button", { name: /^report priya/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^report sam/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^report mia/i })).toBeInTheDocument();
  });

  it("signed out: no own marking with a user id", async () => {
    render(await ChallengePage({ params: Promise.resolve({ id: ID }) }));
    for (const call of markOwn.mock.calls) expect(call[1]).toBeNull();
  });
});
