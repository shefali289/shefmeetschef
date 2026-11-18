import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Challenge } from "@/lib/challenges/types";
import { makeFakeClient, newFakeDb, type FakeDb } from "@/test/fake-supabase-rls";

/*
 * Contract (task 3 slice C, remix page wiring; own file so it does not clash with slice B):
 *   /recipes/[slug]/remix calls getCurrentChallenge(client, nzToday()) and passes
 *   challenge={{ id, title }} to <RemixForm> when the open challenge's baseRecipeSlug (or
 *   baseRecipeId) is this recipe, and challenge={null} otherwise: another recipe's challenge,
 *   no open challenge, or a failing lookup (which never breaks the page). Without Supabase the
 *   form is not shown at all (slice B's not set up message).
 */

vi.mock("server-only", () => ({}));
const { db, getCurrentChallenge, formProps } = vi.hoisted(() => ({
  db: { current: null as unknown as FakeDb },
  getCurrentChallenge: vi.fn(async (_sb: unknown, _today?: string): Promise<Challenge | null> => null),
  formProps: [] as Record<string, unknown>[],
}));
vi.mock("@/components/remix/RemixForm", () => ({
  default: (props: Record<string, unknown>) => {
    formProps.push(props);
    return <div data-testid="remix-form" />;
  },
}));
vi.mock("@/lib/challenges/challenges", () => ({
  getCurrentChallenge: (sb: unknown, today?: string) => (sb ? getCurrentChallenge(sb, today) : Promise.resolve(null)),
  listChallenges: vi.fn(async () => ({ current: null, past: [] })),
  getChallenge: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !db.current) return null;
    return makeFakeClient(db.current, "session");
  }),
}));
vi.mock("@supabase/supabase-js", async (orig) => ({
  ...(await orig<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(() => makeFakeClient(db.current ?? newFakeDb(), "anon")),
}));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: vi.fn(() => null) }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/image", () => import("@/test/next-image-mock"));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  }),
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/recipes/masala-chai/remix",
  useSearchParams: () => new URLSearchParams(),
}));

import RemixPage from "./page";

const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const shefRow = (id: string, slug: string, title: string) => ({
  id,
  slug,
  title,
  description: null,
  reel_url: null,
  youtube_url: null,
  cover_image_url: null,
  source: "shef",
  owner_id: null,
  ingredients: [{ qty: 1, unit: "cup", item: "milk" }],
  steps: [{ text: "Boil." }],
  base_servings: 2,
  prep_minutes: 2,
  cook_minutes: 8,
  cuisine: "indian",
  diet_tags: ["vegetarian"],
  allergens: ["milk"],
  categories: ["drinks"],
  status: "live",
  published_at: "2026-11-01T00:00:00Z",
});
const CHAI = shefRow("11111111-1111-4111-8111-111111111111", "masala-chai", "Masala Chai");
const TIKKA = shefRow("22222222-2222-4222-8222-222222222222", "paneer-tikka", "Paneer Tikka");

const OPEN: Challenge = {
  id: "c2c2c2c2-0000-4000-8000-000000000002",
  title: "Chai, your way",
  description: "Any milk you like",
  startsOn: "2026-11-16",
  endsOn: "2026-11-22",
  baseRecipeId: CHAI.id,
  baseRecipeSlug: CHAI.slug,
  baseRecipeTitle: CHAI.title,
  winnerRemixId: null,
  winner: null,
};

function withSupabase() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  db.current = newFakeDb();
  db.current.rows = [CHAI, TIKKA];
  db.current.user = USER;
  db.current.rpcResult.is_banned = { data: false, error: null };
  db.current.rpcResult.usage_remaining = { data: 3, error: null };
}

const props = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function renderPage(slug: string) {
  render(await RemixPage(props(slug)));
}

/** The challenge prop of the last RemixForm render (undefined if the prop was never passed). */
const lastChallenge = () => formProps.at(-1)?.challenge;

beforeEach(() => {
  formProps.length = 0;
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

describe("remix page and the weekly challenge", () => {
  it("passes the open challenge to the form on its base recipe", async () => {
    withSupabase();
    await renderPage(CHAI.slug);
    expect(screen.getByTestId("remix-form")).toBeInTheDocument();
    expect(getCurrentChallenge).toHaveBeenCalled();
    expect(getCurrentChallenge.mock.calls[0][0]).toBeTruthy();
    expect(getCurrentChallenge.mock.calls[0][1] ?? "2026-11-18").toBe("2026-11-18");
    // only id and title reach the client component
    expect(lastChallenge()).toEqual({ id: OPEN.id, title: OPEN.title });
  });

  it("passes null on another recipe", async () => {
    withSupabase();
    await renderPage(TIKKA.slug);
    expect(screen.getByTestId("remix-form")).toBeInTheDocument();
    expect(lastChallenge()).toBeNull();
  });

  it("passes null when no challenge is open", async () => {
    withSupabase();
    getCurrentChallenge.mockResolvedValue(null);
    await renderPage(CHAI.slug);
    expect(screen.getByTestId("remix-form")).toBeInTheDocument();
    expect(lastChallenge()).toBeNull();
  });

  it("passes null when the lookup fails, and the form still shows", async () => {
    withSupabase();
    getCurrentChallenge.mockRejectedValue(new Error("network down"));
    await renderPage(CHAI.slug);
    expect(screen.getByTestId("remix-form")).toBeInTheDocument();
    expect(lastChallenge()).toBeNull();
  });

  it("without Supabase there is no form and no challenge", async () => {
    await renderPage("masala-chai");
    expect(screen.queryByTestId("remix-form")).toBeNull();
    expect(formProps).toEqual([]);
    expect(screen.getByText(/not set up yet/i)).toBeInTheDocument();
  });
});
