import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Challenge, ChallengeList } from "@/lib/challenges/types";

/*
 * Contract: /challenges (src/app/challenges/page.tsx), a server component.
 * - Reads with getViewer().supabase (or an anon client); listChallenges(client, nzToday()).
 * - Not configured (no Supabase): "Challenges are not set up yet", no list.
 * - Shows the current challenge first (title, link to /challenges/<id>, days left) under a
 *   "This week" heading, then "Past challenges" newest first, each linking to its page and
 *   showing "Winner: <first name>" when it has one.
 * - Empty: "No challenges yet".
 */

vi.mock("server-only", () => ({}));
const { state, listChallenges } = vi.hoisted(() => ({
  state: { configured: true },
  listChallenges: vi.fn(async (_sb: unknown, _today?: string): Promise<ChallengeList> => ({ current: null, past: [] })),
}));
const client = { marker: "client" };
vi.mock("@/lib/auth/session", () => ({
  getViewer: vi.fn(async () =>
    state.configured ? { configured: true, user: null, supabase: client } : { configured: false, user: null, supabase: null },
  ),
  getCurrentUser: vi.fn(async () => ({ configured: state.configured, user: null })),
  adminGate: vi.fn(async () => (state.configured ? { state: "signed-out" } : { state: "not-configured" })),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => (state.configured ? client : null)) }));
vi.mock("@supabase/supabase-js", async (orig) => ({
  ...(await orig<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(() => client),
}));
vi.mock("@/lib/challenges/challenges", () => ({
  listChallenges,
  getCurrentChallenge: vi.fn(async () => null),
  getChallenge: vi.fn(async () => null),
}));
vi.mock("next/image", () => import("@/test/next-image-mock"));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (u: string) => {
    throw new Error(`NEXT_REDIRECT ${u}`);
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/challenges",
  useSearchParams: () => new URLSearchParams(),
}));

import ChallengesPage from "./page";

const challenge = (n: number, over: Partial<Challenge> = {}): Challenge => ({
  id: `c${n}c${n}c${n}c${n}-0000-4000-8000-00000000000${n}`,
  title: `Challenge ${n}`,
  description: null,
  startsOn: "2026-11-16",
  endsOn: "2026-11-22",
  baseRecipeId: "r-chai",
  baseRecipeSlug: "masala-chai",
  baseRecipeTitle: "Masala Chai",
  winnerRemixId: null,
  winner: null,
  ...over,
});

async function renderPage() {
  const ui = await (ChallengesPage as unknown as (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>)({
    searchParams: Promise.resolve({}),
  });
  return render(ui);
}

beforeEach(() => {
  state.configured = true;
  listChallenges.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T01:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("/challenges", () => {
  it("shows the current challenge then past ones with their winner", async () => {
    listChallenges.mockResolvedValueOnce({
      current: challenge(3, { title: "Chai, your way", endsOn: "2026-11-21" }),
      past: [
        challenge(2, {
          title: "Tikka twist",
          startsOn: "2026-11-09",
          endsOn: "2026-11-15",
          winnerRemixId: "r7",
          winner: { remixId: "r7", authorName: "Priya", photoUrl: null },
        }),
        challenge(1, { title: "Dal day", startsOn: "2026-11-02", endsOn: "2026-11-08" }),
      ],
    });
    await renderPage();

    expect(listChallenges).toHaveBeenCalledTimes(1);
    expect(listChallenges.mock.calls[0][0]).toBeTruthy();

    const text = document.body.textContent ?? "";
    expect(text.indexOf("Chai, your way")).toBeGreaterThan(-1);
    expect(text.indexOf("Chai, your way")).toBeLessThan(text.indexOf("Tikka twist"));
    expect(text.indexOf("Tikka twist")).toBeLessThan(text.indexOf("Dal day"));

    expect(screen.getByRole("link", { name: /chai, your way/i })).toHaveAttribute("href", `/challenges/${challenge(3).id}`);
    expect(screen.getByRole("link", { name: /tikka twist/i })).toHaveAttribute("href", `/challenges/${challenge(2).id}`);
    expect(screen.getByRole("link", { name: /dal day/i })).toHaveAttribute("href", `/challenges/${challenge(1).id}`);
    expect(screen.getByText(/3 days left/)).toBeInTheDocument();

    const pastHeading = screen.getByRole("heading", { name: /past challenges/i });
    expect(pastHeading).toBeInTheDocument();
    const tikka = screen.getByRole("link", { name: /tikka twist/i }).closest("li") ?? document.body;
    expect(within(tikka as HTMLElement).getByText(/winner:?\s*priya/i)).toBeInTheDocument();
    const dal = screen.getByRole("link", { name: /dal day/i }).closest("li") ?? document.body;
    expect(within(dal as HTMLElement).queryByText(/winner/i)).toBeNull();
  });

  it("says No challenges yet when there are none", async () => {
    listChallenges.mockResolvedValueOnce({ current: null, past: [] });
    await renderPage();
    expect(screen.getByText(/no challenges yet/i)).toBeInTheDocument();
  });

  it("not configured shows not set up yet", async () => {
    state.configured = false;
    await renderPage();
    expect(screen.getByText(/challenges are not set up yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /past challenges/i })).toBeNull();
  });
});
