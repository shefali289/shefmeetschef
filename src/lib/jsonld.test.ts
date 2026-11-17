import { describe, expect, it } from "vitest";
import { recipeJsonLd, serializeJsonLd } from "./jsonld";
import type { Recipe } from "./types";

const recipe: Recipe = {
  id: "r1",
  slug: "masala-chai",
  title: "Masala Chai",
  description: "Spiced milky tea.",
  reel_url: "https://www.instagram.com/reel/ABC123/",
  youtube_url: null,
  cover_image_url: "https://example.com/chai.jpg",
  source: "shef",
  ingredients: [
    { qty: 2, unit: "cup", item: "milk" },
    { qty: null, unit: null, item: "sugar", note: "to taste" },
  ],
  steps: [{ text: "Boil water with spices." }, { text: "Add milk and tea." }],
  base_servings: 4,
  prep_minutes: 10,
  cook_minutes: 20,
  cuisine: "indian",
  diet_tags: ["vegetarian"],
  allergens: ["milk"],
  categories: ["drinks"],
  status: "live",
  published_at: "2026-01-01T00:00:00Z",
};

describe("recipeJsonLd", () => {
  it("outputs @type Recipe with name, recipeIngredient, recipeInstructions, recipeYield, totalTime ISO 8601", () => {
    const ld = recipeJsonLd(recipe, "https://shefmeetschef.example") as Record<string, unknown>;
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Recipe");
    expect(ld.name).toBe("Masala Chai");
    expect(ld.description).toBe("Spiced milky tea.");
    expect(ld.url).toBe("https://shefmeetschef.example/recipes/masala-chai");

    const ingredients = ld.recipeIngredient as string[];
    expect(ingredients).toHaveLength(2);
    expect(ingredients[0]).toMatch(/2\s*cup.*milk/);
    expect(ingredients[1]).toMatch(/sugar/);

    expect(ld.recipeInstructions).toEqual([
      { "@type": "HowToStep", text: "Boil water with spices." },
      { "@type": "HowToStep", text: "Add milk and tea." },
    ]);
    expect(String(ld.recipeYield)).toMatch(/^4\b/);
    expect(ld.totalTime).toBe("PT30M");
    expect(ld.prepTime).toBe("PT10M");
    expect(ld.cookTime).toBe("PT20M");

    const long = recipeJsonLd({ ...recipe, prep_minutes: 15, cook_minutes: 60 }, "https://x.io");
    expect(long.totalTime).toBe("PT1H15M");

    const noTimes = recipeJsonLd({ ...recipe, prep_minutes: null, cook_minutes: null }, "https://x.io");
    expect(noTimes.totalTime).toBeUndefined();
  });
});

describe("serializeJsonLd", () => {
  it("escapes </script> in text", () => {
    const evil = recipeJsonLd(
      { ...recipe, title: "Chai</script><script>alert(1)</script>", description: "<!-- x" },
      "https://x.io",
    );
    const out = serializeJsonLd(evil);
    expect(out).not.toMatch(/<\/script/i);
    expect(out).not.toContain("<");
    expect(out).not.toContain("<!--");
    // still valid JSON that round-trips to the same object
    expect(JSON.parse(out)).toEqual(evil);
    expect(JSON.parse(out).name).toBe("Chai</script><script>alert(1)</script>");
  });
});

describe("recipeJsonLd image and labels", () => {
  const site = "https://shefmeetschef.example";
  const images = (ld: Record<string, unknown>) => [ld.image].flat();

  it("image is always present", () => {
    expect(images(recipeJsonLd(recipe, site))).toContain("https://example.com/chai.jpg");

    const yt = recipeJsonLd(
      { ...recipe, cover_image_url: null, youtube_url: "https://youtu.be/dQw4w9WgXcQ" },
      site,
    );
    expect(String(images(yt)[0])).toMatch(/^https:\/\/i\.ytimg\.com\/vi\/dQw4w9WgXcQ\//);

    const none = recipeJsonLd({ ...recipe, cover_image_url: null, youtube_url: null }, site);
    expect(images(none)).toEqual([`${site}/og-default.png`]);

    const badYt = recipeJsonLd(
      { ...recipe, cover_image_url: null, youtube_url: "https://evil.io/watch?v=dQw4w9WgXcQ" },
      site + "/",
    );
    expect(images(badYt)).toEqual([`${site}/og-default.png`]);
  });

  it("recipeCuisine and recipeCategory use human labels", () => {
    const ld = recipeJsonLd({ ...recipe, cuisine: "indian", categories: ["air-fryer", "healthy"] }, site);
    expect(ld.recipeCuisine).toBe("Indian");
    const cats = [ld.recipeCategory].flat();
    expect(cats).toContain("Air fryer");
    expect(cats).not.toContain("air-fryer");

    const fest = recipeJsonLd({ ...recipe, categories: ["festival-specials"] }, site);
    expect([fest.recipeCategory].flat()).toContain("Festival specials");
  });
});
