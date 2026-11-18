import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sampleRecipes } from "@/lib/sample-recipes";
import { createPublicSupabaseClient } from "./supabase/public";
import { RecipeSchema, type Recipe } from "./types";

/** Valid recipe slug: lowercase words joined by single hyphens. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isPublic(r: Recipe): boolean {
  return r.status === "live" && r.source === "shef";
}

/** Live Shef recipes from Supabase, or the bundled samples when Supabase is not set up. */
async function fetchRecipes(slug?: string): Promise<Recipe[]> {
  const supabase = createPublicSupabaseClient();
  if (!supabase) return sampleRecipes.filter((r) => isPublic(r) && (!slug || r.slug === slug));

  let query = supabase
    .from("recipes")
    .select("*")
    .eq("status", "live")
    .eq("source", "shef")
    .order("published_at", { ascending: false });
  if (slug) query = query.eq("slug", slug);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load recipes: ${error.message}`);
  // Filter again in code: even a client that sees more (e.g. an admin session) never lists
  // drafts or outside recipes.
  return parseRows(data).filter((r) => isPublic(r) && (!slug || r.slug === slug));
}

function parseRows(data: unknown[] | null): Recipe[] {
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

/**
 * Live Shef recipe for anyone, or the viewer's own outside recipe read through their session
 * client. Outside recipes are returned only when `viewerId` is their owner, so an admin session
 * (which RLS lets read every outside recipe) still only sees its own on the recipe page.
 * Null when not visible. Never cached across users.
 */
export async function getRecipeForViewer(
  slug: string,
  viewer: SupabaseClient | null,
  viewerId: string | null = null,
): Promise<Recipe | null> {
  if (!SLUG_RE.test(slug)) return null;
  const shef = await getRecipeBySlug(slug);
  if (shef) return shef;
  if (!viewer || !viewerId) return null;

  const { data, error } = await viewer
    .from("recipes")
    .select("*")
    .eq("slug", slug)
    .eq("source", "outside")
    .eq("owner_id", viewerId)
    .maybeSingle();
  if (error) throw new Error(`Could not load recipe: ${error.message}`);
  // Checked in code too: the row must really belong to this viewer.
  if (!data || (data as { owner_id?: unknown }).owner_id !== viewerId) return null;
  const [recipe] = parseRows([data]);
  return recipe && recipe.source === "outside" && recipe.status === "live" ? recipe : null;
}
