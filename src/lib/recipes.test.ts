import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATEGORIES, CUISINES, DIET_TAGS, RecipeSchema, type Recipe } from "./types";

function noSupabaseEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
}

beforeEach(() => {
  vi.resetModules();
  noSupabaseEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/sample-recipes");
  vi.doUnmock("@supabase/supabase-js");
});

function fakeRecipe(over: Partial<Recipe>): Recipe {
  return {
    id: "x",
    slug: "x",
    title: "X",
    description: null,
    reel_url: null,
    youtube_url: null,
    cover_image_url: null,
    source: "shef",
    ingredients: [{ qty: 1, unit: "cup", item: "water" }],
    steps: [{ text: "Boil." }],
    base_servings: 2,
    prep_minutes: 5,
    cook_minutes: 5,
    cuisine: "indian",
    diet_tags: [],
    allergens: [],
    categories: [],
    status: "live",
    published_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("recipes data layer", () => {
  it("uses sample recipes when Supabase env is missing", async () => {
    const { sampleRecipes } = await import("@/lib/sample-recipes");
    const { listRecipes, getRecipeBySlug } = await import("./recipes");
    const list = await listRecipes();
    const liveSamples = sampleRecipes.filter((r) => r.status === "live");
    expect(liveSamples.length).toBeGreaterThan(0);
    expect(list.map((r) => r.slug).sort()).toEqual(liveSamples.map((r) => r.slug).sort());
    const chai = await getRecipeBySlug("masala-chai");
    expect(chai?.slug).toBe("masala-chai");
    expect(chai?.status).toBe("live");
  });

  it("getRecipeBySlug returns null for unknown slug", async () => {
    const { getRecipeBySlug } = await import("./recipes");
    await expect(getRecipeBySlug("no-such-recipe")).resolves.toBeNull();
    await expect(getRecipeBySlug("")).resolves.toBeNull();
    await expect(getRecipeBySlug("../etc/passwd")).resolves.toBeNull();
  });

  it("sample recipes pass the Recipe zod schema", async () => {
    const { sampleRecipes } = await import("@/lib/sample-recipes");
    expect(sampleRecipes.length).toBeGreaterThan(0);
    for (const r of sampleRecipes) {
      const res = RecipeSchema.safeParse(r);
      expect(res.success, `${r.slug}: ${res.error?.message}`).toBe(true);
    }
    const slugs = sampleRecipes.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length); // slugs are unique
  });

  it("only returns live recipes", async () => {
    vi.doMock("@/lib/sample-recipes", () => ({
      sampleRecipes: [
        fakeRecipe({ id: "1", slug: "live-one", status: "live" }),
        fakeRecipe({ id: "2", slug: "secret-draft", status: "draft", published_at: null }),
        fakeRecipe({ id: "3", slug: "outside-one", source: "outside" }),
      ],
    }));
    const { listRecipes, getRecipeBySlug } = await import("./recipes");
    const list = await listRecipes();
    expect(list.map((r) => r.slug)).toEqual(["live-one"]);
    await expect(getRecipeBySlug("secret-draft")).resolves.toBeNull();
    await expect(getRecipeBySlug("outside-one")).resolves.toBeNull();
    await expect(getRecipeBySlug("live-one")).resolves.toMatchObject({ slug: "live-one" });
  });

  it("sample recipes cover every cuisine, category and diet tag", async () => {
    const { sampleRecipes } = await import("@/lib/sample-recipes");
    const live = sampleRecipes.filter((r) => r.status === "live" && r.source === "shef");
    expect(live.length).toBeGreaterThanOrEqual(5);
    for (const c of CUISINES) expect(live.some((r) => r.cuisine === c), `cuisine ${c}`).toBe(true);
    for (const c of CATEGORIES)
      expect(live.some((r) => r.categories.includes(c)), `category ${c}`).toBe(true);
    for (const t of DIET_TAGS)
      expect(live.some((r) => r.diet_tags.includes(t)), `diet tag ${t}`).toBe(true);
    expect(live.some((r) => r.slug === "masala-chai")).toBe(true);
  });
});

/** Chainable fake of the Supabase query builder; awaiting it resolves to `result`. */
function fakeSupabase(result: { data: unknown[] | null; error: { message: string } | null }) {
  const eq = vi.fn();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "range", "filter", "match", "in", "is"]) {
    builder[m] = vi.fn(() => builder);
  }
  eq.mockImplementation(() => builder);
  builder.eq = eq;
  builder.maybeSingle = vi.fn(async () => ({ data: result.data?.[0] ?? null, error: result.error }));
  builder.single = builder.maybeSingle;
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  const from = vi.fn(() => builder);
  const createClient = vi.fn(() => ({ from }));
  return { createClient, from, eq };
}

function withSupabaseEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
}

describe("recipes data layer with Supabase", () => {
  it("does not call Supabase when env is missing", async () => {
    const fake = fakeSupabase({ data: [], error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: fake.createClient }));
    const { listRecipes } = await import("./recipes");
    await listRecipes();
    expect(fake.createClient).not.toHaveBeenCalled();
  });

  it("queries live shef recipes and filters by slug", async () => {
    withSupabaseEnv();
    const row = fakeRecipe({ id: "db1", slug: "masala-chai", title: "DB Chai" });
    const fake = fakeSupabase({ data: [row], error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: fake.createClient }));
    const { listRecipes, getRecipeBySlug } = await import("./recipes");

    const list = await listRecipes();
    expect(fake.createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      expect.anything(),
    );
    expect(fake.from).toHaveBeenCalledWith("recipes");
    expect(fake.eq).toHaveBeenCalledWith("status", "live");
    expect(fake.eq).toHaveBeenCalledWith("source", "shef");
    expect(list.map((r) => r.title)).toEqual(["DB Chai"]); // from the DB, not the samples

    fake.eq.mockClear();
    const one = await getRecipeBySlug("masala-chai");
    expect(fake.eq).toHaveBeenCalledWith("status", "live");
    expect(fake.eq).toHaveBeenCalledWith("source", "shef");
    expect(fake.eq).toHaveBeenCalledWith("slug", "masala-chai");
    expect(one?.title).toBe("DB Chai");
  });

  it("drops rows that fail the Recipe schema", async () => {
    withSupabaseEnv();
    const good = fakeRecipe({ id: "g", slug: "good-one" });
    const bad = { ...fakeRecipe({ id: "b", slug: "bad-one" }), title: "", ingredients: "nope" };
    const fake = fakeSupabase({ data: [good, bad], error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: fake.createClient }));
    const { listRecipes } = await import("./recipes");
    expect((await listRecipes()).map((r) => r.slug)).toEqual(["good-one"]);
  });

  it("rejects when Supabase returns an error", async () => {
    withSupabaseEnv();
    const fake = fakeSupabase({ data: null, error: { message: "boom" } });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: fake.createClient }));
    const { listRecipes, getRecipeBySlug } = await import("./recipes");
    await expect(listRecipes()).rejects.toThrow();
    await expect(getRecipeBySlug("masala-chai")).rejects.toThrow();
  });
});

describe("RecipeSchema image URLs", () => {
  it("rejects a non-https cover_image_url", () => {
    const ok = fakeRecipe({ cover_image_url: "https://cdn.example.com/a.jpg" });
    expect(RecipeSchema.safeParse(ok).success).toBe(true);
    expect(RecipeSchema.safeParse(fakeRecipe({ cover_image_url: null })).success).toBe(true);
    for (const url of [
      "javascript:alert(1)",
      "http://cdn.example.com/a.jpg",
      "data:image/png;base64,AAAA",
      "//cdn.example.com/a.jpg",
    ]) {
      expect(RecipeSchema.safeParse(fakeRecipe({ cover_image_url: url })).success, url).toBe(false);
    }
  });
});

/*
 * Fake that applies the recipes RLS rules, so the test does not depend on which filters the code
 * chooses: anon sees live shef recipes; a signed-in viewer also sees their own outside recipes.
 */
type Row = Recipe & { owner_id: string | null };
function rlsClient(rows: Row[], viewerId: string | null, opts: { admin?: boolean } = {}) {
  const calls: { filters: [string, unknown][] } = { filters: [] };
  const from = vi.fn((_table: string) => {
    const filters: [string, unknown][] = [];
    const visible = () =>
      rows
        .filter(
          (r) =>
            (r.status === "live" && r.source === "shef") ||
            (r.source === "outside" && viewerId !== null && (opts.admin || r.owner_id === viewerId)),
        )
        .filter((r) => filters.every(([col, val]) => (r as unknown as Record<string, unknown>)[col] === val));
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "range", "neq", "in", "is", "filter", "match", "not"]) {
      b[m] = vi.fn(() => b);
    }
    b.eq = vi.fn((col: string, val: unknown) => {
      filters.push([col, val]);
      calls.filters.push([col, val]);
      return b;
    });
    b.maybeSingle = vi.fn(async () => ({ data: visible()[0] ?? null, error: null }));
    b.single = vi.fn(async () => {
      const [r] = visible();
      return r ? { data: r, error: null } : { data: null, error: { message: "no rows", code: "PGRST116" } };
    });
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: visible(), error: null }).then(resolve, reject);
    return b;
  });
  const auth = {
    getUser: vi.fn(async () => ({ data: { user: viewerId ? { id: viewerId } : null }, error: null })),
  };
  return { client: { from, auth }, from, calls };
}

const OWNER = "b0000000-0000-4000-8000-000000000002";
const OTHER = "c0000000-0000-4000-8000-000000000003";
const shefRow: Row = { ...fakeRecipe({ id: "s1", slug: "masala-chai", title: "DB Chai" }), owner_id: null };
const outsideRow: Row = {
  ...fakeRecipe({
    id: "o1",
    slug: "reel-nani-dal-abc123",
    title: "Nani's Dal",
    source: "outside",
    reel_url: "https://www.instagram.com/nani.cooks/reel/ABC123/",
  }),
  owner_id: OWNER,
};

describe("getRecipeForViewer", () => {
  it("getRecipeForViewer returns live shef recipes for anyone", async () => {
    // no Supabase env: sample recipes, no viewer needed
    const samples = await import("./recipes");
    await expect(samples.getRecipeForViewer("masala-chai", null)).resolves.toMatchObject({
      slug: "masala-chai",
      source: "shef",
    });
    await expect(samples.getRecipeForViewer("../etc/passwd", null)).resolves.toBeNull();

    vi.resetModules();
    withSupabaseEnv();
    const anon = rlsClient([shefRow, outsideRow], null);
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => anon.client) }));
    const { getRecipeForViewer } = await import("./recipes");
    await expect(getRecipeForViewer("masala-chai", null)).resolves.toMatchObject({ title: "DB Chai" });
    const viewer = rlsClient([shefRow, outsideRow], OTHER);
    await expect(
      getRecipeForViewer("masala-chai", viewer.client as unknown as import("@supabase/supabase-js").SupabaseClient),
    ).resolves.toMatchObject({ title: "DB Chai" });
  });

  it("returns an outside recipe through the viewer's session only", async () => {
    withSupabaseEnv();
    // even if the anon query somehow returned the outside row, it must not be used
    const leakyAnon = rlsClient([shefRow, outsideRow], OWNER);
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => leakyAnon.client) }));
    const { getRecipeForViewer } = await import("./recipes");
    type C = import("@supabase/supabase-js").SupabaseClient;

    await expect(getRecipeForViewer(outsideRow.slug, null)).resolves.toBeNull();

    const other = rlsClient([shefRow, outsideRow], OTHER);
    await expect(getRecipeForViewer(outsideRow.slug, other.client as unknown as C, OTHER)).resolves.toBeNull();

    const owner = rlsClient([shefRow, outsideRow], OWNER);
    const got = await getRecipeForViewer(outsideRow.slug, owner.client as unknown as C, OWNER);
    expect(got).toMatchObject({ slug: outsideRow.slug, title: "Nani's Dal", source: "outside" });
    expect(owner.from).toHaveBeenCalledWith("recipes");
    expect(owner.calls.filters).toContainEqual(["slug", outsideRow.slug]);
  });

  it("an outside recipe is returned only to its owner, even when RLS lets an admin read it", async () => {
    withSupabaseEnv();
    const anon = rlsClient([shefRow, outsideRow], null);
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => anon.client) }));
    const { getRecipeForViewer } = await import("./recipes");
    type C = import("@supabase/supabase-js").SupabaseClient;

    // an admin session can read every outside recipe through RLS, but is not the owner
    const admin = rlsClient([shefRow, outsideRow], OTHER, { admin: true });
    await expect(getRecipeForViewer(outsideRow.slug, admin.client as unknown as C, OTHER)).resolves.toBeNull();
    // a session client with no viewer id is not enough either
    await expect(getRecipeForViewer(outsideRow.slug, admin.client as unknown as C, null)).resolves.toBeNull();
    // the owner still gets it, and shef recipes are unaffected for the admin
    const ownerAdmin = rlsClient([shefRow, outsideRow], OWNER, { admin: true });
    await expect(
      getRecipeForViewer(outsideRow.slug, ownerAdmin.client as unknown as C, OWNER),
    ).resolves.toMatchObject({ slug: outsideRow.slug, source: "outside" });
    await expect(getRecipeForViewer("masala-chai", admin.client as unknown as C, OTHER)).resolves.toMatchObject({
      slug: "masala-chai",
    });
  });

  it("listRecipes never returns outside recipes", async () => {
    withSupabaseEnv();
    // a client that ignores filters and returns everything (e.g. an admin session)
    const fake = fakeSupabase({ data: [shefRow, outsideRow], error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: fake.createClient }));
    const { listRecipes, getRecipeBySlug } = await import("./recipes");
    expect((await listRecipes()).map((r) => r.slug)).toEqual(["masala-chai"]);
    await expect(getRecipeBySlug(outsideRow.slug)).resolves.toBeNull();
  });
});
