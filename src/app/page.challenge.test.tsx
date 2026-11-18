import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Challenge } from "@/lib/challenges/types";
import { makeFakeClient, newFakeDb, type FakeDb } from "@/test/fake-supabase-rls";
import { sampleRecipes } from "@/lib/sample-recipes";

/*
 * Contract (task 3 slice C, home page wiring): the home page calls
 * getCurrentChallenge(client, nzToday()) with a public (anon) or session client, and renders
 * <ChallengeBanner> (a region named "This week's remix challenge") above the latest recipes while
 * a challenge is open. No challenge, or no Supabase (client null), means no banner.
 * Kept in its own file so it does not clash with slice B's tests.
 */

vi.mock("server-only", () => ({}));
const { db, getCurrentChallenge } = vi.hoisted(() => ({
  db: { current: null as unknown as FakeDb },
  getCurrentChallenge: vi.fn(async (_sb: unknown, _today?: string): Promise<Challenge | null> => null),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () =>
    process.env.NEXT_PUBLIC_SUPABASE_URL && db.current ? Object.assign(makeFakeClient(db.current, "session"), { kind: "session" }) : null,
  ),
}));
vi.mock("@supabase/supabase-js", async (orig) => ({
  ...(await orig<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(() => Object.assign(makeFakeClient(db.current ?? newFakeDb(), "anon"), { kind: "public" })),
}));
vi.mock("@/lib/challenges/challenges", () => ({
  // Like the real one: nothing without a client.
  getCurrentChallenge: (sb: unknown, today?: string) => (sb ? getCurrentChallenge(sb, today) : Promise.resolve(null)),
  listChallenges: vi.fn(async () => ({ current: null, past: [] })),
  getChallenge: vi.fn(async () => null),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/image", () => import("@/test/next-image-mock"));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Home from "./page";

const OPEN: Challenge = {
  id: "c2c2c2c2-0000-4000-8000-000000000002",
  title: "Chai, your way",
  description: "Swap the milk, the spice, anything.",
  startsOn: "2026-11-16",
  endsOn: "2026-11-21",
  baseRecipeId: "r-chai",
  baseRecipeSlug: "masala-chai",
  baseRecipeTitle: "Masala Chai",
  winnerRemixId: null,
  winner: null,
};

function withSupabase() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  db.current = newFakeDb();
  db.current.rows = sampleRecipes.map((r) => ({ ...r }));
}

const banner = () => screen.queryByRole("region", { name: /this week['’]s remix challenge/i });

beforeEach(() => {
  getCurrentChallenge.mockReset();
  getCurrentChallenge.mockResolvedValue(null);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T01:00:00Z")); // Wednesday 18 November NZ
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  db.current = null as unknown as FakeDb;
});

describe("home page challenge banner", () => {
  it("home shows the banner while a challenge is open and nothing otherwise or without Supabase", async () => {
    // open challenge
    withSupabase();
    getCurrentChallenge.mockResolvedValue(OPEN);
    const first = render(await Home());
    expect(getCurrentChallenge).toHaveBeenCalled();
    expect(getCurrentChallenge.mock.calls[0][1] ?? "2026-11-18").toBe("2026-11-18");
    const region = banner();
    expect(region).not.toBeNull();
    expect(within(region!).getByText("Chai, your way")).toBeInTheDocument();
    expect(within(region!).getByText(/#ShefMeetsChefRemix/)).toBeInTheDocument();
    expect(within(region!).getByText(/3 days left/)).toBeInTheDocument();
    expect(within(region!).getAllByRole("link").map((a) => a.getAttribute("href"))).toContain(`/challenges/${OPEN.id}`);
    // the latest recipes are still there
    expect(screen.getByRole("heading", { name: /latest recipes/i })).toBeInTheDocument();
    first.unmount();

    // no open challenge
    getCurrentChallenge.mockResolvedValue(null);
    const second = render(await Home());
    expect(banner()).toBeNull();
    expect(screen.queryByText(/#ShefMeetsChefRemix/)).toBeNull();
    second.unmount();

    // no Supabase at all (sample recipes)
    vi.unstubAllEnvs();
    db.current = null as unknown as FakeDb;
    getCurrentChallenge.mockResolvedValue(OPEN); // would show if the page passed a client
    render(await Home());
    expect(banner()).toBeNull();
    expect(screen.queryByText(/#ShefMeetsChefRemix/)).toBeNull();
    expect(screen.getByRole("heading", { name: /latest recipes/i })).toBeInTheDocument();
  });

  it("a failing challenge lookup never breaks the home page", async () => {
    withSupabase();
    getCurrentChallenge.mockRejectedValue(new Error("network down"));
    render(await Home());
    expect(banner()).toBeNull();
    expect(screen.getByRole("heading", { name: /latest recipes/i })).toBeInTheDocument();
  });
});

describe("home page stays static (N9)", () => {
  it("never reads cookies or the session client, and looks up the challenge with the public client", async () => {
    withSupabase();
    vi.mocked(cookies).mockClear();
    vi.mocked(createSupabaseServerClient).mockClear();
    getCurrentChallenge.mockResolvedValue(OPEN);
    render(await Home());
    expect(banner()).not.toBeNull();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
    expect(getCurrentChallenge).toHaveBeenCalledTimes(1);
    expect((getCurrentChallenge.mock.calls[0][0] as { kind?: string }).kind).toBe("public");
  });
});
