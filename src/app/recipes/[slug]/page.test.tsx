import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { INSTAGRAM_URL } from "@/lib/social";
import { fakeSignedUrl, makeFakeClient, newFakeDb, type FakeDb } from "@/test/fake-supabase-rls";
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
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: vi.fn(() => null) }));
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

/* ---------- remixes (task 3 slice B) ---------- */
/*
 * Contract: on a live Shef recipe the page shows <RemixThisButton>, then approved remixes from
 * remix_feed (p_recipe_id = the recipe id, p_sort "newest") in the feed's order, photos signed with
 * the visitor's session client, and a link to /remixes?recipe=<slug>. A signed-in owner also sees
 * their own remixes of this recipe (read from `remixes` through their session, any status) with the
 * status text and a delete button. Outside recipes have none of this; without Supabase it says
 * "Remixes are not set up yet".
 */
const REMIX_RECIPE = { ...shefRow, id: "11111111-1111-4111-8111-111111111111", slug: "paneer-tikka", title: "Paneer Tikka" };
const NEWER_PHOTO = `${OWNER.id}/0f8fad5b-d9cb-469f-a165-70867728950e.jpg`;
const OLDER_PHOTO = `${OTHER.id}/7c9e6679-7425-40de-944b-e07fc1f90ae7.webp`;
const feedRows = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    recipe_id: REMIX_RECIPE.id,
    recipe_slug: REMIX_RECIPE.slug,
    recipe_title: REMIX_RECIPE.title,
    challenge_id: null,
    changes: "Newer: grilled it on the barbecue.",
    photo_path: NEWER_PHOTO,
    author_name: "Priya",
    like_count: 2,
    created_at: "2026-11-18T02:00:00Z",
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    recipe_id: REMIX_RECIPE.id,
    recipe_slug: REMIX_RECIPE.slug,
    recipe_title: REMIX_RECIPE.title,
    challenge_id: null,
    changes: "Older: used halloumi instead.",
    photo_path: OLDER_PHOTO,
    author_name: "Sam",
    like_count: 5,
    created_at: "2026-11-17T02:00:00Z",
  },
];

function withRemixes(user: typeof OWNER | null) {
  withSupabase(user);
  db.current.rows = [REMIX_RECIPE, outsideRow];
  db.current.rpcResult.remix_feed = { data: feedRows, error: null };
  db.current.rpcResult.is_banned = { data: false, error: null };
}

describe("recipe page remixes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    db.current = null as unknown as FakeDb;
  });

  it("Shef recipe shows Remix this and approved remixes newest first with a link to /remixes?recipe=<slug>", async () => {
    withRemixes(OTHER);
    expect(await renderOrNotFound(REMIX_RECIPE.slug)).toBe("rendered");
    expect(screen.getByRole("link", { name: /remix this/i })).toHaveAttribute("href", `/recipes/${REMIX_RECIPE.slug}/remix`);

    const feedCalls = db.current.rpcs.filter((r) => r.fn === "remix_feed");
    expect(feedCalls.length).toBeGreaterThan(0);
    expect(feedCalls[0].args).toMatchObject({ p_recipe_id: REMIX_RECIPE.id, p_sort: "newest" });

    const newer = screen.getByText(feedRows[0].changes);
    const older = screen.getByText(feedRows[1].changes);
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("img", { name: "Priya's remix of Paneer Tikka" })).toHaveAttribute(
      "src",
      fakeSignedUrl("remix-photos", NEWER_PHOTO, 3600),
    );
    expect(screen.getByRole("img", { name: "Sam's remix of Paneer Tikka" })).toBeInTheDocument();
    // photos are signed with the visitor's own session client
    const signs = db.current.storage.filter((s) => s.method.startsWith("createSignedUrl"));
    expect(signs.length).toBeGreaterThan(0);
    for (const s of signs) expect(s).toMatchObject({ client: "session", bucket: "remix-photos" });

    const all = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === `/remixes?recipe=${REMIX_RECIPE.slug}`);
    expect(all.length).toBeGreaterThan(0);
  });

  it("outside recipe has no Remix this or remixes", async () => {
    withRemixes(OWNER);
    expect(await renderOrNotFound(OUTSIDE_SLUG)).toBe("rendered");
    expect(screen.queryByRole("link", { name: /remix this/i })).toBeNull();
    expect(screen.queryByText(/Remixes are not set up yet/i)).toBeNull();
    expect(screen.queryByText(feedRows[0].changes)).toBeNull();
    expect(db.current.rpcs.filter((r) => r.fn === "remix_feed")).toEqual([]);
    expect(screen.getAllByRole("link").filter((a) => (a.getAttribute("href") ?? "").startsWith("/remixes"))).toEqual([]);
  });

  it("owner sees own pending remix with Waiting for a quick check", async () => {
    withRemixes(OWNER);
    db.current.remixes = [
      {
        id: "bbbbbbbb-0000-4000-8000-000000000001",
        recipe_id: REMIX_RECIPE.id,
        user_id: OWNER.id,
        status: "pending",
        challenge_id: null,
        changes: "My pending remix: extra chilli.",
        photo_path: `${OWNER.id}/11111111-2222-4333-8444-555555555555.jpg`,
        created_at: "2026-11-18T03:00:00Z",
      },
      {
        // someone else's pending remix is never shown
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        recipe_id: REMIX_RECIPE.id,
        user_id: OTHER.id,
        status: "pending",
        challenge_id: null,
        changes: "Not yours: pending by someone else.",
        photo_path: `${OTHER.id}/11111111-2222-4333-8444-666666666666.jpg`,
        created_at: "2026-11-18T03:00:00Z",
      },
    ];
    expect(await renderOrNotFound(REMIX_RECIPE.slug)).toBe("rendered");
    expect(screen.getByText("My pending remix: extra chilli.")).toBeInTheDocument();
    expect(screen.getByText("Waiting for a quick check")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete my remix/i })).toBeInTheDocument();
    expect(screen.queryByText("Not yours: pending by someone else.")).toBeNull();
    const reads = db.current.reads.filter((r) => r.table === "remixes");
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      expect(r.client).toBe("session");
      expect(r.filters).toContainEqual(["recipe_id", REMIX_RECIPE.id]);
      expect(r.filters).toContainEqual(["user_id", OWNER.id]);
    }

    // signed out: approved remixes only, no own-remix read
    db.current.user = null;
    db.current.reads = [];
    cleanup();
    expect(await renderOrNotFound(REMIX_RECIPE.slug)).toBe("rendered");
    expect(screen.queryByText("My pending remix: extra chilli.")).toBeNull();
    expect(screen.getByText(feedRows[0].changes)).toBeInTheDocument();
    expect(db.current.reads.filter((r) => r.table === "remixes")).toEqual([]);
  });

  it("not configured shows not set up yet", async () => {
    db.current = newFakeDb();
    render(await RecipePage({ params: Promise.resolve({ slug: "masala-chai" }) }));
    expect(screen.getAllByText(/Remixes are not set up yet/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /remix this/i })).toBeInTheDocument();
    expect(db.current.rpcs).toEqual([]);
    expect(db.current.sessionClients).toBe(0);
  });
});

/* ---------- slice B review findings (B1, NIT3, NIT4, NIT6, NIT11) ---------- */
const TARGET_44 = /(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/;

function manyFeedRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ...feedRows[0],
    id: `aaaaaaaa-0000-4000-8000-${String(100 + i).padStart(12, "0")}`,
    changes: `Feed remix ${i}`,
    photo_path: `${OTHER.id}/0f8fad5b-d9cb-469f-a165-${String(100 + i).padStart(12, "0")}.jpg`,
  }));
}

/** Every path passed to createSignedUrl(s), across calls. */
function signedPaths(): string[] {
  return db.current.storage
    .filter((s) => s.method.startsWith("createSignedUrl"))
    .flatMap((s) => (Array.isArray(s.args[0]) ? (s.args[0] as string[]) : [s.args[0] as string]));
}

describe("recipe page remixes (review fixes)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    db.current = null as unknown as FakeDb;
  });

  it("B1: the remixes heading is a stable focus target and the section has a persistent status region", async () => {
    // a viewer with no remixes of their own: the region must be there before any delete happens
    withRemixes(OTHER);
    expect(await renderOrNotFound(REMIX_RECIPE.slug)).toBe("rendered");
    const heading = document.getElementById("remixes-heading");
    expect(heading).not.toBeNull();
    expect(heading!.tagName).toBe("H2");
    expect(heading).toHaveAttribute("tabindex", "-1");
    const section = heading!.closest("section");
    expect(section).not.toBeNull();
    // a role="status" region in the section that is not part of any card or list item
    const regions = within(section!)
      .queryAllByRole("status")
      .filter((r) => !r.closest("li") && !r.closest("article") && !r.closest("form"));
    expect(regions.length).toBe(1);
  });

  it("NIT3: the recipe page asks remix_feed for at most 7 rows and signs at most 6 photos", async () => {
    withRemixes(OTHER);
    db.current.rpcResult.remix_feed = { data: manyFeedRows(25), error: null };
    expect(await renderOrNotFound(REMIX_RECIPE.slug)).toBe("rendered");
    const call = db.current.rpcs.find((r) => r.fn === "remix_feed");
    expect(call).toBeDefined();
    expect(Number(call!.args?.p_limit)).toBeGreaterThanOrEqual(1);
    expect(Number(call!.args?.p_limit)).toBeLessThanOrEqual(7);
    expect(signedPaths().length).toBeLessThanOrEqual(6);
    expect(screen.queryAllByText(/^Feed remix \d+$/).length).toBeLessThanOrEqual(6);
    expect(screen.getByText("Feed remix 0")).toBeInTheDocument();
  });

  it("NIT4: an owner's approved remix shows once, in Your remixes with its status and delete", async () => {
    withRemixes(OWNER);
    const shared = feedRows[0];
    db.current.remixes = [
      {
        id: shared.id,
        recipe_id: REMIX_RECIPE.id,
        user_id: OWNER.id,
        status: "approved",
        challenge_id: null,
        changes: shared.changes,
        photo_path: shared.photo_path,
        created_at: shared.created_at,
      },
    ];
    expect(await renderOrNotFound(REMIX_RECIPE.slug)).toBe("rendered");
    // once on the page, as the owner's card (Live + delete), not again in the public list
    expect(screen.getAllByText(shared.changes)).toHaveLength(1);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /delete my remix/i })).toHaveLength(1);
    // other people's approved remixes are still listed
    expect(screen.getByText(feedRows[1].changes)).toBeInTheDocument();
  });

  it("NIT6: an outside recipe has no link ending in /remix", async () => {
    withRemixes(OWNER);
    expect(await renderOrNotFound(OUTSIDE_SLUG)).toBe("rendered");
    const remixLinks = screen.getAllByRole("link").filter((a) => /\/remix(\?|#|$)/.test(a.getAttribute("href") ?? ""));
    expect(remixLinks).toEqual([]);
  });

  it("NIT11: See all remixes is a 44px target", async () => {
    withRemixes(OTHER);
    expect(await renderOrNotFound(REMIX_RECIPE.slug)).toBe("rendered");
    const all = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === `/remixes?recipe=${REMIX_RECIPE.slug}`);
    expect(all).toBeDefined();
    expect(all!.className).toMatch(TARGET_44);
  });
});

