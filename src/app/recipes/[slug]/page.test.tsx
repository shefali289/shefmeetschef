import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { INSTAGRAM_URL } from "@/lib/social";
import { makeFakeClient, newFakeDb, type FakeDb } from "@/test/fake-supabase-rls";
import * as pageModule from "./page";
import RecipePage, { generateMetadata } from "./page";

vi.mock("server-only", () => ({}));
const { db } = vi.hoisted(() => ({ db: { current: null as unknown as FakeDb } }));
// Both return nothing useful until a test sets the Supabase env (the sample-recipe test runs without).
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
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("next/image", () => import("@/test/next-image-mock"));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/recipes/masala-chai",
  useSearchParams: () => new URLSearchParams(),
}));

describe("recipe page", () => {
  it("h1 title wraps long words instead of overflowing on mobile", async () => {
    // Runs on sample recipes (no Supabase env vars).
    render(await RecipePage({ params: Promise.resolve({ slug: "masala-chai" }) }));
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toMatch(/(^|\s)(break-words|\[overflow-wrap:anywhere\])(\s|$)/);
  });
});

/* ---------- outside recipes (Slice B) ---------- */
const OWNER = { id: "b0000000-0000-4000-8000-000000000002", email: "owner@example.com" };
const OTHER = { id: "c0000000-0000-4000-8000-000000000003", email: "other@example.com" };
const OUTSIDE_SLUG = "reel-nanis-dal-abc123";
const outsideRow = {
  id: "o1",
  slug: OUTSIDE_SLUG,
  title: "Nani's Dal Tadka",
  description: "A weeknight dal.",
  reel_url: "https://www.instagram.com/nani.cooks/reel/ABC123/",
  youtube_url: null,
  cover_image_url: null,
  source: "outside",
  owner_id: OWNER.id,
  ingredients: [{ qty: 1, unit: "cup", item: "toor dal" }],
  steps: [{ text: "Pressure cook the dal." }],
  base_servings: 2,
  prep_minutes: 5,
  cook_minutes: 20,
  cuisine: "indian",
  diet_tags: ["vegan"],
  allergens: [],
  categories: [],
  status: "live",
  published_at: null,
};

function withSupabase(user: typeof OWNER | null) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  db.current ??= newFakeDb();
  db.current.rows = [outsideRow];
  db.current.user = user;
  db.current.rpcResult.usage_remaining = { data: 10, error: null };
}
const props = (slug = OUTSIDE_SLUG) => ({ params: Promise.resolve({ slug }) });

async function renderOrNotFound(slug = OUTSIDE_SLUG): Promise<"not-found" | "rendered"> {
  try {
    render(await RecipePage(props(slug)));
    return "rendered";
  } catch (e) {
    if (String((e as Error).message).includes("NEXT_NOT_FOUND")) return "not-found";
    throw e;
  }
}

describe("outside recipe page", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    db.current = null as unknown as FakeDb;
  });

  it("outside recipe shows From @handle's reel, the embed and Follow @shefmeetschef", async () => {
    withSupabase(OWNER);
    expect(await renderOrNotFound()).toBe("rendered");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Nani's Dal Tadka");
    expect(screen.getByText(/From @nani\.cooks['’]s reel/)).toBeInTheDocument();
    expect(screen.queryByText(/from Shef['’]s kitchen/i)).toBeNull();
    const embed = document.querySelector("iframe[src*='instagram.com']");
    expect(embed).not.toBeNull();
    expect(embed!.getAttribute("src")).toBe("https://www.instagram.com/reel/ABC123/embed");
    expect(screen.getAllByText(/Follow @shefmeetschef/i).length).toBeGreaterThan(0);
    const follow = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === INSTAGRAM_URL);
    expect(follow.length).toBeGreaterThan(0);
  });

  it("outside recipe page is noindex and has no JSON-LD", async () => {
    withSupabase(OWNER);
    const meta = await generateMetadata(props());
    expect(meta.robots).toMatchObject({ index: false });
    expect(await renderOrNotFound()).toBe("rendered");
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
  });

  it("someone else's outside slug is a 404", async () => {
    withSupabase(OTHER);
    expect(await renderOrNotFound()).toBe("not-found");
    const meta = await generateMetadata(props());
    expect(JSON.stringify(meta)).not.toContain("Nani");

    db.current.user = null; // anonymous
    expect(await renderOrNotFound()).toBe("not-found");
    expect(JSON.stringify(await generateMetadata(props()))).not.toContain("Nani");
  });

  it("outside lookups read the session per request (never ISR cached)", async () => {
    withSupabase(OWNER);
    expect(await renderOrNotFound()).toBe("rendered");
    const afterFirst = db.current.sessionClients;
    expect(afterFirst).toBeGreaterThan(0);

    // same slug, different visitor: must be looked up again with the new session
    db.current.user = OTHER;
    expect(await renderOrNotFound()).toBe("not-found");
    expect(db.current.sessionClients).toBeGreaterThan(afterFirst);

    // the page is never forced static, and outside recipes are never in static params
    expect((pageModule as { dynamic?: string }).dynamic).not.toBe("force-static");
    const params = await pageModule.generateStaticParams();
    expect(params.map((p) => p.slug)).not.toContain(OUTSIDE_SLUG);
  });
});

/* ---------- the heart (Slice C review B3) ---------- */
const shefRow = {
  ...outsideRow,
  id: "s1",
  slug: "dal-makhani",
  title: "Dal Makhani",
  reel_url: null,
  source: "shef",
  owner_id: null,
  published_at: "2026-11-01T00:00:00Z",
};

function heart() {
  return screen.queryByRole("button", { name: /save to my cookbook/i });
}

describe("recipe page heart", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    db.current = null as unknown as FakeDb;
  });

  it("heart is pressed when the viewer has saved the recipe", async () => {
    withSupabase(OTHER);
    db.current.rows = [shefRow, outsideRow];
    // another user's save of the same recipe exists too; only the viewer's counts
    db.current.saves = [
      { id: "sv-other", user_id: OWNER.id, recipe_id: shefRow.id },
      { id: "sv-mine", user_id: OTHER.id, recipe_id: shefRow.id },
    ];
    expect(await renderOrNotFound(shefRow.slug)).toBe("rendered");
    expect(heart()).toHaveAttribute("aria-pressed", "true");
    const saveReads = db.current.reads.filter((r) => r.table === "saves");
    expect(saveReads.length).toBeGreaterThan(0);
    for (const r of saveReads) {
      expect(r.client).toBe("session");
      expect(r.filters).toContainEqual(["recipe_id", shefRow.id]);
      expect(r.filters).toContainEqual(["user_id", OTHER.id]);
    }
  });

  it("heart is not pressed when the viewer has not saved it", async () => {
    withSupabase(OTHER);
    db.current.rows = [shefRow, outsideRow];
    // only someone else's save, and the viewer's save of a different recipe
    db.current.saves = [
      { id: "sv-other", user_id: OWNER.id, recipe_id: shefRow.id },
      { id: "sv-mine", user_id: OTHER.id, recipe_id: "some-other-recipe" },
    ];
    expect(await renderOrNotFound(shefRow.slug)).toBe("rendered");
    expect(heart()).toHaveAttribute("aria-pressed", "false");
  });

  it("signed out shows Sign in to save and queries no saves", async () => {
    withSupabase(null);
    db.current.rows = [shefRow, outsideRow];
    db.current.saves = [{ id: "sv-other", user_id: OWNER.id, recipe_id: shefRow.id }];
    expect(await renderOrNotFound(shefRow.slug)).toBe("rendered");
    expect(heart()).toBeNull();
    const link = screen.getByRole("link", { name: /sign in to save/i });
    expect(link.getAttribute("href")).toBe(`/sign-in?next=${encodeURIComponent(`/recipes/${shefRow.slug}`)}`);
    expect(db.current.reads.filter((r) => r.table === "saves")).toEqual([]);
  });

  it("not configured queries no saves", async () => {
    // no Supabase env: sample recipes, no session client
    db.current = newFakeDb();
    db.current.user = OTHER;
    db.current.saves = [{ id: "sv-mine", user_id: OTHER.id, recipe_id: "anything" }];
    render(await RecipePage({ params: Promise.resolve({ slug: "masala-chai" }) }));
    expect(heart()).toBeNull();
    expect(db.current.reads.filter((r) => r.table === "saves")).toEqual([]);
    expect(db.current.sessionClients).toBe(0);
  });
});
