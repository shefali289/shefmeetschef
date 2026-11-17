import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { sampleRecipes } from "@/lib/sample-recipes";
import { supabaseConfig } from "./supabase/config";
import { RecipeSchema, type Recipe } from "./types";

/** Valid recipe slug: lowercase words joined by single hyphens. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isPublic(r: Recipe): boolean {
  return r.status === "live" && r.source === "shef";
}

/** Live Shef recipes from Supabase, or the bundled samples when Supabase is not set up. */
async function fetchRecipes(slug?: string): Promise<Recipe[]> {
  const config = supabaseConfig();
  if (!config) return sampleRecipes.filter((r) => isPublic(r) && (!slug || r.slug === slug));

  const supabase = createClient(config.url, config.anonKey, {
    auth: { persistSession: false },
  });
  let query = supabase
    .from("recipes")
    .select("*")
    .eq("status", "live")
    .eq("source", "shef")
    .order("published_at", { ascending: false });
  if (slug) query = query.eq("slug", slug);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load recipes: ${error.message}`);
  return (data ?? []).flatMap((row) => {
    const parsed = RecipeSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function listRecipes(): Promise<Recipe[]> {
  return fetchRecipes();
}

/** Cached per request so generateMetadata and the page share one fetch. */
export const getRecipeBySlug = cache(async (slug: string): Promise<Recipe | null> => {
  if (!SLUG_RE.test(slug)) return null;
  const [recipe] = await fetchRecipes(slug);
  return recipe ?? null;
});
