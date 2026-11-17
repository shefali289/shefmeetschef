import { humanLabel } from "./labels";
import { ingredientText } from "./scaling";
import { shareImage } from "./share-image";
import type { Recipe } from "./types";

function isoDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `PT${h ? `${h}H` : ""}${m || !h ? `${m}M` : ""}`;
}

/** schema.org Recipe for search engines. */
export function recipeJsonLd(recipe: Recipe, siteUrl: string): Record<string, unknown> {
  const { prep_minutes: prep, cook_minutes: cook } = recipe;
  const total = prep === null && cook === null ? null : (prep ?? 0) + (cook ?? 0);
  const site = siteUrl.replace(/\/+$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.title,
    description: recipe.description ?? undefined,
    url: `${site}/recipes/${recipe.slug}`,
    image: [shareImage(recipe, site)],
    author: { "@type": "Person", name: "Shef" },
    datePublished: recipe.published_at ?? undefined,
    recipeCuisine: recipe.cuisine ? humanLabel(recipe.cuisine) : undefined,
    recipeCategory: recipe.categories.length ? recipe.categories.map(humanLabel) : undefined,
    recipeYield: `${recipe.base_servings} servings`,
    prepTime: prep === null ? undefined : isoDuration(prep),
    cookTime: cook === null ? undefined : isoDuration(cook),
    totalTime: total === null ? undefined : isoDuration(total),
    recipeIngredient: recipe.ingredients.map(ingredientText),
    recipeInstructions: recipe.steps.map((s) => ({ "@type": "HowToStep", text: s.text })),
  };
}

/** JSON safe to place inside a <script> tag: no raw <, > or & characters. */
export function serializeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
