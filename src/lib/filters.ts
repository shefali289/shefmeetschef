import { z } from "zod";
import { CATEGORIES, CUISINES, DIET_TAGS, type Recipe } from "@/lib/types";
import { Q_MAX, type Filters, type Group } from "./filters-query";

// Query helpers live in filters-query.ts so client components do not bundle zod.
export { filtersHref, filtersToQuery, GROUP_KEYS, Q_MAX, type Filters, type Group } from "./filters-query";

export type SearchParamsInput =
  | Record<string, string | string[] | undefined>
  | URLSearchParams;

const GROUPS = {
  cuisine: z.enum(CUISINES),
  category: z.enum(CATEGORIES),
  diet: z.enum(DIET_TAGS),
} satisfies Record<Group, z.ZodType<string>>;

function rawValues(params: SearchParamsInput, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const v = params[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Allow-listed, de-duplicated values; accepts repeated keys and comma-separated lists. */
function parseGroup(params: SearchParamsInput, group: Group): string[] {
  const values = rawValues(params, group).flatMap((v) => v.split(","));
  const allowed = values.filter((v) => GROUPS[group].safeParse(v).success);
  return [...new Set(allowed)];
}

export function parseFilters(searchParams: SearchParamsInput): Filters {
  const [q = ""] = rawValues(searchParams, "q");
  return {
    q: q.trim().slice(0, Q_MAX),
    cuisine: parseGroup(searchParams, "cuisine"),
    category: parseGroup(searchParams, "category"),
    diet: parseGroup(searchParams, "diet"),
  };
}

function matchesText(recipe: Recipe, q: string): boolean {
  const needle = q.toLowerCase();
  const haystack = [recipe.title, recipe.description ?? "", ...recipe.ingredients.map((i) => i.item)];
  return haystack.some((s) => s.toLowerCase().includes(needle));
}

/** AND across groups, OR within a group; empty groups match everything. */
export function filterRecipes(recipes: Recipe[], filters: Filters): Recipe[] {
  return recipes.filter(
    (r) =>
      (!filters.q || matchesText(r, filters.q)) &&
      (filters.cuisine.length === 0 || (r.cuisine !== null && filters.cuisine.includes(r.cuisine))) &&
      (filters.category.length === 0 || r.categories.some((c) => filters.category.includes(c))) &&
      (filters.diet.length === 0 || r.diet_tags.some((d) => filters.diet.includes(d))),
  );
}
