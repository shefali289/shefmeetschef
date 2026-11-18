import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Challenge, ChallengeDetail, ChallengeEntry } from "@/lib/challenges/types";

/*
 * Contract: /challenges/[id] (src/app/challenges/[id]/page.tsx), a server component.
 * - Admin is decided on the server with adminGate() (state "admin"); everyone else is a visitor.
 * - getChallenge(client, id, { admin, today: nzToday() }); null -> notFound().
 *   Not configured (getViewer().configured false) -> "Challenges are not set up yet" (no 404).
 * - Shows the title, description, the dates, #ShefMeetsChefRemix, and the approved entries in the
 *   order given (newest first for visitors, by likes for the admin) using the remix cards.
 * - While open: a "Remix this" link to /recipes/<base slug>/remix and the note
 *   "Entries may be featured in Shef's reel".
 * - Admin, after the end only: one "Pick as winner" form per entry (hidden challenge_id and
 *   remix_id, posting pickWinner from src/app/admin/challenges/actions), button labelled with the
 *   author ("Pick Priya's remix as winner"), 44px. Never for visitors, never before the end.
 * - With a winner: that entry shows the WinnerBadge ("Winner") and the page says
 *   "Featured in Shef's reel".
 */

vi.mock("server-only", () => ({}));
const { state, getChallenge, pickWinner, markLiked } = vi.hoisted(() => ({
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
}));
vi.mock("@/app/admin/challenges/actions", () => ({ pickWinner, createChallenge: vi.fn() }));
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

import * as pageModule from "./page";
import ChallengePage from "./page";

const ID = "c2c2c2c2-0000-4000-8000-000000000002";
const TARGET_44 = /(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/;

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
const BY_LIKES = [NEWEST[1], NEWEST[2], NEWEST[0]];

function detail(over: Partial<ChallengeDetail> = {}): ChallengeDetail {
  return { challenge: challenge(), entries: NEWEST, sort: "newest", open: true, ended: false, ...over };
}

async function renderPage(id = ID): Promise<"rendered" | "not-found"> {
  try {
    render(await ChallengePage({ params: Promise.resolve({ id }) }));
    return "rendered";
  } catch (e) {
    if (String((e as Error).message).includes("NEXT_NOT_FOUND")) return "not-found";
    throw e;
  }
}

const orderOf = (...needles: string[]) => {
  const text = document.body.textContent ?? "";
  return needles.map((n) => text.indexOf(n));
};
const pickButtons = () => screen.queryAllByRole("button", { name: /pick .*as (the )?winner/i });

beforeEach(() => {
  state.configured = true;
  state.admin = false;
  state.cook = false;
  state.likedIds = [];
  markLiked.mockClear();
  getChallenge.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T01:00:00Z")); // Wednesday 18 November NZ
});
afterEach(() => vi.useRealTimers());

describe("/challenges/[id]", () => {
  it("entries newest first for visitors", async () => {
    getChallenge.mockResolvedValue(detail());
    expect(await renderPage()).toBe("rendered");

    expect(getChallenge).toHaveBeenCalledTimes(1);
    const [sb, id, opts] = getChallenge.mock.calls[0];
    expect(sb).toBeTruthy();
    expect(id).toBe(ID);
    expect(opts?.admin ?? false).toBe(false);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Chai, your way");
    expect(screen.getByText(/#ShefMeetsChefRemix/)).toBeInTheDocument();
    const [a, b, c] = orderOf("Jaggery instead of sugar", "Oat milk and cardamom", "Extra ginger");
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);

    // open: remix the base recipe, and the featuring note
    expect(screen.getAllByRole("link", { name: /remix this/i }).some((l) => l.getAttribute("href") === "/recipes/masala-chai/remix")).toBe(true);
    expect(screen.getByText(/entries may be featured in Shef['’]s reel/i)).toBeInTheDocument();
    expect(pickButtons()).toEqual([]);
  });

  it("visitors never see Pick as winner, even after the end", async () => {
    getChallenge.mockResolvedValue(detail({ open: false, ended: true }));
    await renderPage();
    expect(pickButtons()).toEqual([]);
    expect(document.querySelector('input[name="remix_id"]')).toBeNull();
    // ended: no Remix this for the challenge any more
    expect(screen.queryAllByRole("link", { name: /remix this/i })).toEqual([]);
  });

  it("admin sees entries by likes and Pick as winner after the end", async () => {
    state.admin = true;
    getChallenge.mockResolvedValue(detail({ entries: BY_LIKES, sort: "likes", open: false, ended: true }));
    await renderPage();

    expect(getChallenge.mock.calls[0]?.[2]).toMatchObject({ admin: true });
    const [priya, sam, mia] = orderOf("Oat milk and cardamom", "Extra ginger", "Jaggery instead of sugar");
    expect(priya).toBeGreaterThan(-1);
    expect(priya).toBeLessThan(sam);
    expect(sam).toBeLessThan(mia);

    const buttons = pickButtons();
    expect(buttons).toHaveLength(3);
    const pickPriya = screen.getByRole("button", { name: /pick priya['’]s remix as (the )?winner/i });
    expect(pickPriya.className).toMatch(TARGET_44);
    const form = pickPriya.closest("form")!;
    expect(form).not.toBeNull();
    expect((form.querySelector('input[name="challenge_id"]') as HTMLInputElement).value).toBe(ID);
    expect((form.querySelector('input[name="remix_id"]') as HTMLInputElement).value).toBe(BY_LIKES[0].id);
  });

  it("admin cannot pick a winner before the end", async () => {
    state.admin = true;
    getChallenge.mockResolvedValue(detail({ entries: BY_LIKES, sort: "likes", open: true, ended: false }));
    await renderPage();
    expect(pickButtons()).toEqual([]);
    expect(screen.getByText(/pick a winner once (it|the challenge) (has )?ends?/i)).toBeInTheDocument();
  });

  it("winner badge and Featured in Shef's reel", async () => {
    const withWinner = [entry(3, "Mia", "Jaggery instead of sugar", 2), entry(2, "Priya", "Oat milk and cardamom", 9, true)];
    getChallenge.mockResolvedValue(
      detail({
        challenge: challenge({ winnerRemixId: withWinner[1].id, winner: { remixId: withWinner[1].id, authorName: "Priya", photoUrl: null } }),
        entries: withWinner,
        open: false,
        ended: true,
      }),
    );
    await renderPage();
    // case-sensitive: the heading/line, not the "may be featured" note
    expect(screen.getAllByText(/Featured in Shef['’]s reel/).length).toBeGreaterThan(0);
    const badges = screen.getAllByText(/^Winner$/);
    expect(badges).toHaveLength(1);
    // the badge sits with Priya's entry, not Mia's
    const item = badges[0].closest("li, article") as HTMLElement;
    expect(item).not.toBeNull();
    expect(item.textContent).toContain("Oat milk and cardamom");
    expect(item.textContent).not.toContain("Jaggery");
  });

  it("no winner means no badge and no Featured line", async () => {
    getChallenge.mockResolvedValue(detail({ open: false, ended: true }));
    await renderPage();
    expect(screen.queryAllByText(/^Winner$/)).toEqual([]);
    expect(screen.queryAllByText(/Featured in Shef['’]s reel/)).toEqual([]);
  });

  it("an empty challenge says no entries yet", async () => {
    getChallenge.mockResolvedValue(detail({ entries: [] }));
    await renderPage();
    expect(screen.getByText(/no entries yet/i)).toBeInTheDocument();
  });

  it("unknown id is a 404", async () => {
    getChallenge.mockResolvedValue(null);
    expect(await renderPage("dddddddd-0000-4000-8000-000000000000")).toBe("not-found");
    expect(await renderPage("not-a-uuid")).toBe("not-found");
  });

  it("not configured shows not set up yet", async () => {
    state.configured = false;
    getChallenge.mockResolvedValue(null);
    expect(await renderPage()).toBe("rendered");
    expect(screen.getByText(/challenges are not set up yet/i)).toBeInTheDocument();
  });
});

/* ---------- slice C review follow-ups ---------- */

type DetailWithMore = ChallengeDetail & { hasMore: boolean };
type GenerateMetadata = (p: { params: Promise<{ id: string }> }) => Promise<{ title?: unknown }>;
const itemOf = (el: HTMLElement) => el.closest("li, article") as HTMLElement;

describe("/challenges/[id] review follow-ups", () => {
  it("a signed-in viewer sees the entries they already liked pressed (B1)", async () => {
    state.cook = true;
    state.likedIds = [NEWEST[1].id]; // Priya's
    getChallenge.mockResolvedValue(detail());
    await renderPage();

    expect(markLiked).toHaveBeenCalledTimes(1);
    const [sb, uid, cards] = markLiked.mock.calls[0];
    expect(sb).toBeTruthy();
    expect(uid).toBe(COOK.id);
    expect((cards as { id: string }[]).map((c) => c.id)).toEqual(NEWEST.map((e) => e.id));

    const pressed = screen.getAllByRole("button", { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(itemOf(pressed[0]).textContent).toContain("Oat milk and cardamom");
    expect(screen.getAllByRole("button", { pressed: false }).length).toBeGreaterThanOrEqual(2);
    // the order is unchanged
    const [a, b, c] = orderOf("Jaggery instead of sugar", "Oat milk and cardamom", "Extra ginger");
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it("signed-out visitors never read likes (B1)", async () => {
    getChallenge.mockResolvedValue(detail());
    await renderPage();
    expect(markLiked).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("button", { pressed: true })).toEqual([]);
  });

  it("links to /remixes?challenge=<id> when there are more entries (N2)", async () => {
    getChallenge.mockResolvedValue({ ...detail(), hasMore: true } as DetailWithMore);
    await renderPage();
    const more = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === `/remixes?challenge=${ID}`);
    expect(more).toBeDefined();
    expect(more!).toHaveAccessibleName(/.+/);
    expect(more!.className).toMatch(TARGET_44);
  });

  it("no more-entries link when everything fits (N2)", async () => {
    getChallenge.mockResolvedValue({ ...detail(), hasMore: false } as DetailWithMore);
    await renderPage();
    expect(screen.queryAllByRole("link").some((a) => (a.getAttribute("href") ?? "").startsWith("/remixes?challenge="))).toBe(false);
  });

  it("pick-winner buttons have unique names even for two A home cook entries (N3)", async () => {
    state.admin = true;
    const twins = [entry(1, "A home cook", "Extra ginger", 5), entry(2, "A home cook", "Oat milk and cardamom", 4), entry(3, "Mia", "Jaggery", 1)];
    getChallenge.mockResolvedValue(detail({ entries: twins, sort: "likes", open: false, ended: true }));
    await renderPage();
    const names = pickButtons().map((b) => b.textContent?.trim() ?? "");
    const accessible = pickButtons().map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "");
    expect(names).toHaveLength(3);
    expect(new Set(accessible).size).toBe(3);
    // each name still says whose remix it is
    for (const n of accessible) expect(n).toMatch(/pick .*as (the )?winner/i);
  });

  it("the current winner shows Current winner and no pick button (N3)", async () => {
    state.admin = true;
    const withWinner = [entry(2, "Priya", "Oat milk and cardamom", 9, true), entry(1, "Sam", "Extra ginger", 5)];
    getChallenge.mockResolvedValue(
      detail({
        challenge: challenge({ winnerRemixId: withWinner[0].id, winner: { remixId: withWinner[0].id, authorName: "Priya", photoUrl: null } }),
        entries: withWinner,
        sort: "likes",
        open: false,
        ended: true,
      }),
    );
    await renderPage();
    const current = screen.getByText(/current winner/i);
    expect(itemOf(current).textContent).toContain("Oat milk and cardamom");
    expect(within(itemOf(current)).queryAllByRole("button", { name: /pick .*as (the )?winner/i })).toEqual([]);
    expect(pickButtons()).toHaveLength(1);
    expect(itemOf(pickButtons()[0]).textContent).toContain("Extra ginger");
  });

  it("the metadata title includes the challenge title (N11)", async () => {
    const generateMetadata = (pageModule as unknown as { generateMetadata?: GenerateMetadata }).generateMetadata;
    expect(typeof generateMetadata).toBe("function");
    getChallenge.mockResolvedValue(detail());
    const meta = await generateMetadata!({ params: Promise.resolve({ id: ID }) });
    expect(JSON.stringify(meta.title)).toContain("Chai, your way");

    getChallenge.mockResolvedValue(null);
    const missing = await generateMetadata!({ params: Promise.resolve({ id: "dddddddd-0000-4000-8000-000000000000" }) });
    expect(JSON.stringify(missing.title ?? "")).not.toContain("Chai, your way");
  });
});
