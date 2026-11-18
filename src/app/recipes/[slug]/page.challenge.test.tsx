import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Challenge } from "@/lib/challenges/types";
import { makeFakeClient, newFakeDb, type FakeDb } from "@/test/fake-supabase-rls";
import { sampleRecipes } from "@/lib/sample-recipes";

/*
 * Contract (task 3 slice C, recipe page wiring): the recipe page calls
 * getCurrentChallenge(client, nzToday()) and, when the open challenge's baseRecipeSlug is this
 * recipe, renders <ChallengeBanner onBaseRecipe> (a region named "This week's remix challenge")
 * whose Remix this link goes to /recipes/<slug>/remix. Other recipes, outside recipes, no open
 * challenge and no Supabase show no banner. A failing lookup never breaks the page.
 * Kept in its own file so it does not clash with slice B's page.test.tsx.
 */

vi.mock("server-only", () => ({}));
const { db, getCurrentChallenge } = vi.hoisted(() => ({
  db: { current: null as unknown as FakeDb },
  getCurrentChallenge: vi.fn(async (_sb: unknown, _today?: string): Promise<Challenge | null> => null),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !db.current) return null;
    db.current.sessionClients++;
    return makeFakeClient(db.current, "session");
  }),
}));
vi.mock("@supabase/supabase-js", async (orig) => ({
  ...(await orig<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(() => makeFakeClient(db.current ?? newFakeDb(), "anon")),
}));
vi.mock("@/lib/challenges/challenges", () => ({
  getCurrentChallenge: (sb: unknown, today?: string) => (sb ? getCurrentChallenge(sb, today) : Promise.resolve(null)),
  listChallenges: vi.fn(async () => ({ current: null, past: [] })),
  getChallenge: vi.fn(async () => null),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/image", () => import("@/test/next-image-mock"));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: vi.fn(() => null) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (u: string) => {
    throw new Error(`NEXT_REDIRECT ${u}`);
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/recipes/masala-chai",
  useSearchParams: () => new URLSearchParams(),
}));

import RecipePage from "./page";

const OWNER = { id: "b0000000-0000-4000-8000-000000000002", email: "owner@example.com" };
const BASE = sampleRecipes.find((r) => r.slug === "masala-chai")!;
const OTHER = sampleRecipes.find((r) => r.slug !== "masala-chai")!;
const OUTSIDE_SLUG = "reel-nanis-dal-abc123";

const OPEN: Challenge = {
  id: "c2c2c2c2-0000-4000-8000-000000000002",
  title: "Chai, your way",
  description: null,
  startsOn: "2026-11-16",
  endsOn: "2026-11-21",
  baseRecipeId: BASE.id,
  baseRecipeSlug: BASE.slug,
  baseRecipeTitle: BASE.title,
  winnerRemixId: null,
  winner: null,
};

function withSupabase(user: typeof OWNER | null = null) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  db.current = newFakeDb();
  db.current.user = user;
  db.current.rows = [
    ...sampleRecipes.map((r) => ({ ...r })),
    {
      ...BASE,
      id: "o1",
      slug: OUTSIDE_SLUG,
      title: "Nani's Dal Tadka",
      source: "outside",
      owner_id: OWNER.id,
      reel_url: "https://www.instagram.com/nani.cooks/reel/ABC123/",
      youtube_url: null,
      published_at: null,
    },
  ];
  db.current.rpcResult.usage_remaining = { data: 3, error: null };
}

const props = (slug: string) => ({ params: Promise.resolve({ slug }) });
const banner = () => screen.queryByRole("region", { name: /this week['’]s remix challenge/i });

beforeEach(() => {
  getCurrentChallenge.mockReset();
  getCurrentChallenge.mockResolvedValue(OPEN);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T01:00:00Z")); // Wednesday 18 November NZ
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  db.current = null as unknown as FakeDb;
});

describe("recipe page challenge banner", () => {
  it("base recipe page shows the challenge banner", async () => {
    withSupabase();
    render(await RecipePage(props(BASE.slug)));
    const region = banner();
    expect(region).not.toBeNull();
    expect(within(region!).getByText("Chai, your way")).toBeInTheDocument();
    expect(within(region!).getByText(/#ShefMeetsChefRemix/)).toBeInTheDocument();
    expect(within(region!).getByText(/3 days left/)).toBeInTheDocument();
    expect(within(region!).getByRole("link", { name: /remix this/i })).toHaveAttribute("href", `/recipes/${BASE.slug}/remix`);
    expect(within(region!).getAllByRole("link").map((a) => a.getAttribute("href"))).toContain(`/challenges/${OPEN.id}`);
  });

  it("another recipe page has no challenge banner", async () => {
    withSupabase();
    render(await RecipePage(props(OTHER.slug)));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(OTHER.title);
    expect(banner()).toBeNull();
    expect(screen.queryByText(/#ShefMeetsChefRemix/)).toBeNull();
  });

  it("an outside recipe never shows the banner, even if it matched", async () => {
    withSupabase(OWNER);
    getCurrentChallenge.mockResolvedValue({ ...OPEN, baseRecipeId: "o1", baseRecipeSlug: OUTSIDE_SLUG });
    render(await RecipePage(props(OUTSIDE_SLUG)));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Nani's Dal Tadka");
    expect(banner()).toBeNull();
  });

  it("no open challenge, no Supabase, or a failing lookup means no banner", async () => {
    withSupabase();
    getCurrentChallenge.mockResolvedValue(null);
    const a = render(await RecipePage(props(BASE.slug)));
    expect(banner()).toBeNull();
    a.unmount();

    getCurrentChallenge.mockRejectedValue(new Error("network down"));
    const b = render(await RecipePage(props(BASE.slug)));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(BASE.title);
    expect(banner()).toBeNull();
    b.unmount();

    vi.unstubAllEnvs();
    db.current = null as unknown as FakeDb;
    getCurrentChallenge.mockResolvedValue(OPEN);
    render(await RecipePage(props(BASE.slug)));
    expect(banner()).toBeNull();
  });
});
