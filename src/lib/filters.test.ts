import { describe, expect, it } from "vitest";
import { filterRecipes, filtersToQuery, parseFilters, type Filters } from "./filters";
import type { Recipe } from "./types";

function recipe(over: Partial<Recipe> & Pick<Recipe, "id" | "slug" | "title">): Recipe {
  return {
    description: null,
    reel_url: null,
    youtube_url: null,
    cover_image_url: null,
    source: "shef",
    ingredients: [],
    steps: [{ text: "Cook." }],
    base_servings: 2,
    prep_minutes: 5,
    cook_minutes: 10,
    cuisine: null,
    diet_tags: [],
    allergens: [],
    categories: [],
    status: "live",
    published_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const chai = recipe({
  id: "1",
  slug: "masala-chai",
  title: "Masala Chai",
  description: "Spiced milky tea for rainy evenings.",
  cuisine: "indian",
  diet_tags: ["vegetarian", "gluten-free"],
  categories: ["drinks"],
  ingredients: [
    { qty: 2, unit: "cup", item: "whole milk" },
    { qty: 1, unit: "tsp", item: "Cardamom pods" },
  ],
});
const chana = recipe({
  id: "2",
  slug: "air-fryer-chana",
  title: "Crispy Air Fryer Chana",
  description: "Crunchy chickpea snack.",
  cuisine: "indian",
  diet_tags: ["vegetarian", "vegan", "gluten-free"],
  categories: ["healthy", "air-fryer"],
  ingredients: [{ qty: 400, unit: "g", item: "chickpeas" }],
});
const pasta = recipe({
  id: "3",
  slug: "tikka-pasta",
  title: "Tikka Masala Pasta",
  description: null,
  cuisine: "fusion",
  diet_tags: ["vegetarian"],
  categories: ["kids-and-parties"],
  ingredients: [{ qty: 200, unit: "g", item: "penne" }],
});
const noodles = recipe({
  id: "4",
  slug: "hakka-noodles",
  title: "Veg Hakka Noodles",
  description: "Indo-Chinese street favourite.",
  cuisine: "chinese",
  diet_tags: ["vegan", "halal"],
  categories: [],
  ingredients: [{ qty: 150, unit: "g", item: "noodles" }],
});
const all = [chai, chana, pasta, noodles];

const empty: Filters = { q: "", cuisine: [], category: [], diet: [] };
const slugs = (rs: Recipe[]) => rs.map((r) => r.slug).sort();

describe("parseFilters", () => {
  it("parses q, cuisine, category, diet from search params", () => {
    // Next.js page searchParams object form; comma-separated or repeated values both work.
    expect(
      parseFilters({
        q: "chai",
        cuisine: "indian,italian",
        category: ["drinks", "healthy"],
        diet: "vegan",
      }),
    ).toEqual({
      q: "chai",
      cuisine: ["indian", "italian"],
      category: ["drinks", "healthy"],
      diet: ["vegan"],
    });

    // URLSearchParams form, repeated keys.
    const usp = new URLSearchParams("q=paneer&cuisine=fusion&diet=halal&diet=gluten-free");
    expect(parseFilters(usp)).toEqual({
      q: "paneer",
      cuisine: ["fusion"],
      category: [],
      diet: ["halal", "gluten-free"],
    });

    expect(parseFilters({})).toEqual(empty);
    expect(parseFilters(new URLSearchParams())).toEqual(empty);
  });

  it("ignores unknown filter values", () => {
    expect(
      parseFilters({
        cuisine: "indian,klingon,<script>",
        category: ["drinks", "drop table recipes"],
        diet: "carnivore",
        evil: "1",
        q: undefined,
      }),
    ).toEqual({ q: "", cuisine: ["indian"], category: ["drinks"], diet: [] });

    // Duplicates collapse, empty items are dropped.
    expect(parseFilters({ cuisine: "indian,,indian", diet: ["vegan", "vegan", ""] })).toEqual({
      q: "",
      cuisine: ["indian"],
      category: [],
      diet: ["vegan"],
    });

    // A non-string q (repeated key) does not crash; first value used.
    expect(parseFilters({ q: ["chai", "pasta"] }).q).toBe("chai");
  });

  it("trims and caps q at 100 chars", () => {
    expect(parseFilters({ q: "   chai  " }).q).toBe("chai");
    expect(parseFilters({ q: "    " }).q).toBe("");
    const long = "a".repeat(250);
    expect(parseFilters({ q: `  ${long}  ` }).q).toHaveLength(100);
    expect(parseFilters(new URLSearchParams({ q: long })).q).toBe("a".repeat(100));
  });
});

describe("filtersToQuery", () => {
  it("round-trips filters to query string", () => {
    const f: Filters = {
      q: "masala chai & more",
      cuisine: ["indian", "chinese"],
      category: ["drinks", "air-fryer"],
      diet: ["vegan", "halal"],
    };
    const qs = filtersToQuery(f);
    expect(qs).not.toBe("");
    expect(qs.startsWith("?")).toBe(false);
    const back = parseFilters(new URLSearchParams(qs));
    expect(back.q).toBe(f.q);
    expect([...back.cuisine].sort()).toEqual([...f.cuisine].sort());
    expect([...back.category].sort()).toEqual([...f.category].sort());
    expect([...back.diet].sort()).toEqual([...f.diet].sort());

    // Stable order: same filters in a different order give the identical string.
    const shuffled: Filters = {
      diet: ["halal", "vegan"],
      category: ["air-fryer", "drinks"],
      cuisine: ["chinese", "indian"],
      q: "masala chai & more",
    };
    expect(filtersToQuery(shuffled)).toBe(qs);

    // Keys in fixed order q, cuisine, category, diet; no empty keys.
    expect(filtersToQuery({ q: "chai", cuisine: ["indian"], category: [], diet: ["vegan"] })).toBe(
      "q=chai&cuisine=indian&diet=vegan",
    );
    expect(filtersToQuery({ q: "", cuisine: [], category: ["drinks"], diet: [] })).toBe(
      "category=drinks",
    );
    expect(filtersToQuery(empty)).toBe("");
  });
});

describe("filterRecipes", () => {
  it("empty filters return all", () => {
    expect(slugs(filterRecipes(all, empty))).toEqual(slugs(all));
    expect(filterRecipes([], empty)).toEqual([]);
  });

  it("text search matches title, description and ingredient items, case-insensitive", () => {
    // title
    expect(slugs(filterRecipes(all, { ...empty, q: "MASALA" }))).toEqual([
      "masala-chai",
      "tikka-pasta",
    ]);
    // description
    expect(slugs(filterRecipes(all, { ...empty, q: "street favourite" }))).toEqual([
      "hakka-noodles",
    ]);
    // ingredient item
    expect(slugs(filterRecipes(all, { ...empty, q: "cardamom" }))).toEqual(["masala-chai"]);
    expect(slugs(filterRecipes(all, { ...empty, q: "Chickpeas" }))).toEqual(["air-fryer-chana"]);
    // null description does not crash; no match returns empty
    expect(filterRecipes(all, { ...empty, q: "zzz-no-match" })).toEqual([]);
    // Regex metacharacters are treated literally, never as a pattern.
    expect(filterRecipes(all, { ...empty, q: ".*" })).toEqual([]);
  });

  it("combines filters with AND across groups, OR within a group", () => {
    // OR within cuisine
    expect(slugs(filterRecipes(all, { ...empty, cuisine: ["fusion", "chinese"] }))).toEqual([
      "hakka-noodles",
      "tikka-pasta",
    ]);
    // OR within diet
    expect(slugs(filterRecipes(all, { ...empty, diet: ["halal", "gluten-free"] }))).toEqual([
      "air-fryer-chana",
      "hakka-noodles",
      "masala-chai",
    ]);
    // AND across groups: vegan + indian
    expect(slugs(filterRecipes(all, { ...empty, cuisine: ["indian"], diet: ["vegan"] }))).toEqual([
      "air-fryer-chana",
    ]);
    // AND with category and text
    expect(
      slugs(filterRecipes(all, { q: "chai", cuisine: ["indian"], category: ["drinks"], diet: [] })),
    ).toEqual(["masala-chai"]);
    expect(
      filterRecipes(all, { q: "chai", cuisine: ["indian"], category: ["healthy"], diet: [] }),
    ).toEqual([]);
    // Recipe with null cuisine never matches a cuisine filter
    const untyped = recipe({ id: "5", slug: "mystery", title: "Mystery" });
    expect(filterRecipes([untyped], { ...empty, cuisine: ["indian"] })).toEqual([]);
  });
});
