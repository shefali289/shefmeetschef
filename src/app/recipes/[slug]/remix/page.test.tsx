import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { makeFakeClient, newFakeDb, type FakeDb } from "@/test/fake-supabase-rls";

/*
 * Contract: /recipes/[slug]/remix (src/app/recipes/[slug]/remix/page.tsx), async server component
 *   RemixPage({ params: Promise<{ slug }> }); metadata (or generateMetadata) with robots noindex.
 * - Not configured: "Remixes are not set up yet", no redirect, no data read.
 * - Signed out: redirect("/sign-in?next=" + encodeURIComponent("/recipes/<slug>/remix")).
 * - Only live Shef recipes (getRecipeBySlug); an outside recipe (even the viewer's own) or an
 *   unknown slug is notFound().
 * - Banned (rpc is_banned() true): the can't-post message instead of the form.
 * - Otherwise <RemixForm> with usage_remaining('remix', 5): "<n> of 5 remixes left today".
 */

vi.mock("server-only", () => ({}));
const { db } = vi.hoisted(() => ({ db: { current: null as unknown as FakeDb } }));
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

import * as pageModule from "./page";
import RemixPage from "./page";

const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const shefRow = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "masala-chai",
  title: "Masala Chai",
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
};
const outsideRow = {
  ...shefRow,
  id: "o1",
  slug: "reel-nanis-dal-abc123",
  title: "Nani's Dal",
  reel_url: "https://www.instagram.com/nani.cooks/reel/ABC123/",
  source: "outside",
  owner_id: USER.id,
  published_at: null,
};

const props = (slug = "masala-chai") => ({ params: Promise.resolve({ slug }) });

function withSupabase(user: typeof USER | null, banned = false) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  db.current = newFakeDb();
  db.current.rows = [shefRow, outsideRow];
  db.current.user = user;
  db.current.rpcResult.usage_remaining = { data: 3, error: null };
  db.current.rpcResult.is_banned = { data: banned, error: null };
}

async function outcome(slug = "masala-chai"): Promise<string> {
  try {
    render(await RemixPage(props(slug)));
    return "rendered";
  } catch (e) {
    return String((e as { digest?: string }).digest ?? (e as Error).message);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  db.current = null as unknown as FakeDb;
});

describe("remix page", () => {
  it("signed-out redirects to sign-in", async () => {
    withSupabase(null);
    expect(await outcome()).toBe(`NEXT_REDIRECT;/sign-in?next=${encodeURIComponent("/recipes/masala-chai/remix")}`);
  });

  it("outside or unknown slug is a 404", async () => {
    withSupabase(USER);
    // the viewer's own outside reel cannot be remixed
    expect(await outcome(outsideRow.slug)).toBe("NEXT_NOT_FOUND");
    expect(await outcome("no-such-recipe")).toBe("NEXT_NOT_FOUND");
    expect(await outcome("Bad Slug!")).toBe("NEXT_NOT_FOUND");
  });

  it("banned user sees the can't-post message", async () => {
    withSupabase(USER, true);
    expect(await outcome()).toBe("rendered");
    expect(screen.getByText(/can[’']t post|cannot post/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/photo/i)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    const banCheck = db.current.rpcs.find((r) => r.fn === "is_banned");
    expect(banCheck).toMatchObject({ client: "session" });
  });

  it("page is noindex", async () => {
    withSupabase(USER);
    const mod = pageModule as { metadata?: { robots?: unknown }; generateMetadata?: (p: unknown) => Promise<{ robots?: unknown }> };
    const meta = mod.generateMetadata ? await mod.generateMetadata(props()) : mod.metadata;
    expect(meta?.robots).toMatchObject({ index: false });
    expect((pageModule as { dynamic?: string }).dynamic).not.toBe("force-static");
  });

  it("signed in shows the form for the recipe with 3 of 5 remixes left today", async () => {
    withSupabase(USER);
    expect(await outcome()).toBe("rendered");
    expect(screen.getAllByText(/Masala Chai/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/photo/i)).toHaveAttribute("type", "file");
    expect(screen.getByText(/3 of 5 remixes left today/)).toBeInTheDocument();
    const counter = db.current.rpcs.find((r) => r.fn === "usage_remaining");
    expect(counter).toMatchObject({ client: "session", args: { kind: "remix", lim: 5 } });
    expect(db.current.rpcs.filter((r) => r.fn === "consume_usage")).toEqual([]);
  });

  it("not configured shows not set up yet", async () => {
    db.current = newFakeDb();
    expect(await outcome()).toBe("rendered");
    expect(screen.getByText(/Remixes are not set up yet/i)).toBeInTheDocument();
    expect(db.current.sessionClients).toBe(0);
  });
});
