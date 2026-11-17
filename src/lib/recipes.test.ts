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
