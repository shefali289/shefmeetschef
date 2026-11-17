// The cookbook read model: the user's saves and folders, grouped for /cookbook. Client-safe types.
import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_LIMITS } from "@/lib/limits";

export interface CookbookRecipe {
  id: string;
  slug: string;
  title: string;
  cover_image_url: string | null;
  source: "shef" | "outside";
}

/** One row of `saves` joined to its recipe (`recipe:recipes(...)`); recipe is null if not visible. */
export interface SaveRow {
  id: string;
  folder_id: string | null;
  created_at: string;
  recipe: CookbookRecipe | null;
}

export interface FolderRow {
  id: string;
  name: string;
}

/** One of the user's own outside recipes (source 'outside', owner_id = user), read from `recipes`. */
export type ReelRow = CookbookRecipe & { created_at: string };

export interface CookbookItem {
  /** Null for one of the user's reels that is not (or no longer) saved. */
  saveId: string | null;
  folderId: string | null;
  savedAt: string;
  recipe: CookbookRecipe;
}

export interface CookbookFolder {
  id: string;
  name: string;
  items: CookbookItem[];
}

export interface Cookbook {
  /** Saves of visible recipes other than the user's own reels, newest first. */
  all: CookbookItem[];
  /** Every folder (empty ones too), sorted by name; items include outside recipes filed there. */
  folders: CookbookFolder[];
  /** The user's own outside recipes, saved or not, newest first. */
  myReels: CookbookItem[];
  /** Saves whose recipe is gone or no longer visible, so the user can remove them. */
  unavailable: { saveId: string }[];
  /** Saves that count toward the limit: everything but the user's own reels (as the DB trigger counts). */
  used: number;
  limit: number;
}

function newestFirst(a: { savedAt: string }, b: { savedAt: string }): number {
  return a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0;
}

/**
 * Groups saves into All saves and folders, lists the user's own reels and the saves whose recipe
 * is no longer available.
 */
export function buildCookbook({
  saves,
  folders,
  reels = [],
  limit = FREE_LIMITS.saves,
}: {
  saves: SaveRow[];
  folders: FolderRow[];
  reels?: ReelRow[];
  limit?: number;
}): Cookbook {
  const reelIds = new Set(reels.map((r) => r.id));
  const unavailable = saves.filter((s) => !s.recipe).map((s) => ({ saveId: s.id }));
  const items: CookbookItem[] = saves
    .flatMap((s) =>
      s.recipe ? [{ saveId: s.id, folderId: s.folder_id, savedAt: s.created_at, recipe: s.recipe }] : [],
    )
    .sort(newestFirst);
  const all = items.filter((i) => !reelIds.has(i.recipe.id));
  const saveOf = new Map(items.map((i) => [i.recipe.id, i]));

  const myReels = [...reels]
    .sort((a, b) => newestFirst({ savedAt: a.created_at }, { savedAt: b.created_at }))
    .map(({ created_at, ...recipe }): CookbookItem => {
      const saved = saveOf.get(recipe.id);
      return {
        saveId: saved?.saveId ?? null,
        folderId: saved?.folderId ?? null,
        savedAt: saved?.savedAt ?? created_at,
        recipe,
      };
    });

  const sorted = [...folders].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return {
    all,
    myReels,
    unavailable,
    folders: sorted.map((f) => ({ id: f.id, name: f.name, items: items.filter((i) => i.folderId === f.id) })),
    used: all.length + unavailable.length,
    limit,
  };
}

/** Reads the user's saves, folders and own reels through the given (session) client, so RLS applies. */
export async function loadCookbook(supabase: SupabaseClient, userId: string): Promise<Cookbook> {
  const [saves, folders, reels] = await Promise.all([
    supabase
      .from("saves")
      .select("id, folder_id, created_at, recipe:recipes(id, slug, title, cover_image_url, source)")
      .order("created_at", { ascending: false }),
    supabase.from("folders").select("id, name").order("name"),
    supabase
      .from("recipes")
      .select("id, slug, title, cover_image_url, source, created_at")
      .eq("source", "outside")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false }),
  ]);
  if (saves.error) throw new Error(`Could not load saves: ${saves.error.message}`);
  if (folders.error) throw new Error(`Could not load folders: ${folders.error.message}`);
  if (reels.error) throw new Error(`Could not load reels: ${reels.error.message}`);
  return buildCookbook({
    saves: (saves.data ?? []) as unknown as SaveRow[],
    folders: (folders.data ?? []) as FolderRow[],
    reels: (reels.data ?? []) as ReelRow[],
  });
}
