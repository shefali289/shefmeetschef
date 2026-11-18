import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fakeSignedUrl, makeFakeClient, newFakeDb, type FakeDb } from "@/test/fake-supabase-rls";

/*
 * Contract: /remixes (src/app/remixes/page.tsx), async server component
 *   RemixesPage({ searchParams: Promise<{ recipe?, challenge?, page? }> })
 * - Lists approved remixes from remix_feed in the feed's order (newest first), with photos signed
 *   by the visitor's session client and like hearts.
 * - ?recipe=<slug> filters by that live Shef recipe (looked up by slug; an invalid or unknown slug
 *   is ignored); ?challenge=<uuid> filters by challenge (a non-uuid is ignored).
 * - 24 a page: ?page=2 is p_offset 24; a link to the next page when there are more.
 * - Without Supabase: "Remixes are not set up yet" and no data read.
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
  usePathname: () => "/remixes",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./actions", () => ({ toggleLike: vi.fn(async () => ({})), deleteRemix: vi.fn(async () => ({})) }));

import RemixesPage from "./page";

const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const CHALLENGE = "22222222-2222-4222-8222-222222222222";
const shefRow = {
  id: RECIPE_ID,
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

const row = (i: number) => ({
  id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`,
  recipe_id: RECIPE_ID,
  recipe_slug: "masala-chai",
  recipe_title: "Masala Chai",
  challenge_id: null,
  changes: `Remix number ${i}`,
  photo_path: `${USER.id}/0f8fad5b-d9cb-469f-a165-${String(i).padStart(12, "0")}.jpg`,
  author_name: i % 2 ? "Priya" : "Sam",
  like_count: i,
  created_at: new Date(Date.UTC(2026, 10, 18) - i * 3_600_000).toISOString(),
});

type Search = { recipe?: string; challenge?: string; page?: string };
const props = (searchParams: Search = {}) => ({ searchParams: Promise.resolve(searchParams) });

function withSupabase(rows: unknown[], user: typeof USER | null = null) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  db.current = newFakeDb();
  db.current.rows = [shefRow];
  db.current.user = user;
  db.current.rpcResult.remix_feed = { data: rows, error: null };
}

const feedArgs = () => db.current.rpcs.filter((r) => r.fn === "remix_feed").map((r) => r.args ?? {});

afterEach(() => {
  vi.unstubAllEnvs();
  db.current = null as unknown as FakeDb;
});

describe("/remixes", () => {
  it("lists approved remixes newest first", async () => {
    const rows = [row(1), row(2), row(3)];
    withSupabase(rows);
    render(await RemixesPage(props()));
    expect(feedArgs()).toHaveLength(1);
    expect(feedArgs()[0]).toMatchObject({ p_recipe_id: null, p_challenge_id: null, p_sort: "newest", p_offset: 0 });
    const texts = rows.map((r) => screen.getByText(r.changes));
    for (let i = 1; i < texts.length; i++) {
      expect(texts[i - 1].compareDocumentPosition(texts[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // rows 1 and 3 are both by Priya: two photos share that alt, in feed order (newest first)
    const priya = screen.getAllByRole("img", { name: "Priya's remix of Masala Chai" });
    expect(priya.map((img) => img.getAttribute("src"))).toEqual([
      fakeSignedUrl("remix-photos", rows[0].photo_path, 3600),
      fakeSignedUrl("remix-photos", rows[2].photo_path, 3600),
    ]);
    const sam = screen.getByRole("img", { name: "Sam's remix of Masala Chai" });
    expect(sam).toHaveAttribute("src", fakeSignedUrl("remix-photos", rows[1].photo_path, 3600));
    // photo order follows the feed too: newest (row 1) before row 2 before row 3
    expect(priya[0].compareDocumentPosition(sam) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sam.compareDocumentPosition(priya[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const s of db.current.storage.filter((x) => x.method.startsWith("createSignedUrl"))) {
      expect(s).toMatchObject({ client: "session", bucket: "remix-photos" });
    }
    // signed out: hearts are sign-in links
    expect(screen.getAllByRole("link", { name: /sign in to like/i }).length).toBe(3);
  });

  it("filters by ?recipe= and ?challenge=, ignoring invalid values", async () => {
    withSupabase([row(1)]);
    render(await RemixesPage(props({ recipe: "masala-chai" })));
    expect(feedArgs()[0]).toMatchObject({ p_recipe_id: RECIPE_ID, p_challenge_id: null });

    for (const recipe of ["no-such-recipe", "Bad Slug!", "../../etc"]) {
      withSupabase([row(1)]);
      render(await RemixesPage(props({ recipe })));
      expect({ recipe, args: feedArgs()[0] }).toEqual({ recipe, args: expect.objectContaining({ p_recipe_id: null }) });
    }

    withSupabase([row(1)]);
    render(await RemixesPage(props({ challenge: CHALLENGE })));
    expect(feedArgs()[0]).toMatchObject({ p_recipe_id: null, p_challenge_id: CHALLENGE });

    withSupabase([row(1)]);
    render(await RemixesPage(props({ challenge: "1 or 1=1" })));
    expect(feedArgs()[0]).toMatchObject({ p_challenge_id: null });
  });

  it("pages 24 at a time", async () => {
    withSupabase(Array.from({ length: 25 }, (_, i) => row(i + 1)));
    render(await RemixesPage(props()));
    expect(feedArgs()[0]).toMatchObject({ p_offset: 0 });
    expect([24, 25]).toContain(feedArgs()[0].p_limit);
    expect(screen.queryAllByText(/^Remix number \d+$/).length).toBeLessThanOrEqual(24);
    const next = screen.getAllByRole("link").find((a) => /[?&]page=2(&|$)/.test(a.getAttribute("href") ?? ""));
    expect(next).toBeDefined();
    expect(next!.className).toMatch(/(^|\s)(min-h|h)-(1[1-9]|[2-9]\d)(\s|$)/);

    withSupabase([row(30)]);
    render(await RemixesPage(props({ page: "2" })));
    expect(feedArgs()[0]).toMatchObject({ p_offset: 24 });

    for (const page of ["0", "-1", "abc", "1e9x"]) {
      withSupabase([row(1)]);
      render(await RemixesPage(props({ page })));
      expect({ page, args: feedArgs()[0] }).toEqual({ page, args: expect.objectContaining({ p_offset: 0 }) });
    }
  });

  it("an empty feed says there are no remixes yet", async () => {
    withSupabase([]);
    render(await RemixesPage(props()));
    expect(screen.getByText(/no remixes yet/i)).toBeInTheDocument();
  });

  it("not configured shows not set up yet", async () => {
    db.current = newFakeDb();
    render(await RemixesPage(props()));
    expect(screen.getByText(/Remixes are not set up yet/i)).toBeInTheDocument();
    expect(db.current.sessionClients).toBe(0);
    expect(db.current.rpcs).toEqual([]);
  });
});
