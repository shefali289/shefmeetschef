// Remix read model for server components: the public feed (remix_feed) and the viewer's own remixes.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signRemixPhotos } from "./photos";
import type { OwnRemixCard, RemixCardData, RemixFeedPage, RemixFeedRow, RemixStatus } from "./types";

export { statusLabel } from "./status";

/** Cards per page on /remixes. */
export const REMIX_PAGE_SIZE = 24;

/** Shown when a remix's author has no name on their profile. */
export const ANONYMOUS_AUTHOR = "A home cook";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Pages past this are not worth a database call (1000 pages of 24). */
const MAX_PAGE = 1000;

export interface FeedOptions {
  recipeId?: string | null;
  challengeId?: string | null;
  sort?: string | null;
  page?: number | string | null;
  /** Cards per page, 1 to 24 (default 24). */
  limit?: number;
}

export function asUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

/** A whole page number from 1 up; anything else is page 1. */
export function asPage(value: unknown): number {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_PAGE ? n : 1;
}

function toCard(row: RemixFeedRow, photoUrl: string | null): RemixCardData {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    recipeSlug: row.recipe_slug,
    recipeTitle: row.recipe_title,
    challengeId: row.challenge_id,
    changes: row.changes,
    authorName: row.author_name?.trim() || ANONYMOUS_AUTHOR,
    likeCount: Number(row.like_count) || 0,
    createdAt: row.created_at,
    photoUrl,
    liked: false,
  };
}

/** Approved remixes, newest first (or by likes), 24 a page. A feed error gives an empty page. */
export async function loadRemixFeed(supabase: SupabaseClient, options: FeedOptions = {}): Promise<RemixFeedPage> {
  const page = asPage(options.page);
  const size = Math.min(REMIX_PAGE_SIZE, Math.max(1, Math.floor(options.limit ?? REMIX_PAGE_SIZE)));
  const { data, error } = await supabase.rpc("remix_feed", {
    p_recipe_id: asUuid(options.recipeId),
    p_challenge_id: asUuid(options.challengeId),
    p_sort: options.sort === "likes" ? "likes" : "newest",
    // One extra row tells us whether there is a next page.
    p_limit: size + 1,
    p_offset: (page - 1) * size,
  });
  if (error || !Array.isArray(data)) return { cards: [], page, hasMore: false };
  const rows = (data as RemixFeedRow[]).slice(0, size);
  const urls = await signRemixPhotos(supabase, rows.map((r) => r.photo_path));
  return { cards: rows.map((r) => toCard(r, urls[r.photo_path] ?? null)), page, hasMore: data.length > size };
}

type OwnRow = {
  id: string;
  recipe_id: string;
  status: RemixStatus;
  challenge_id: string | null;
  changes: string | null;
  photo_path: string | null;
  created_at: string;
};

/** The viewer's own remixes of one recipe, any status, newest first, read through their session (RLS). */
export async function loadOwnRemixes(
  supabase: SupabaseClient,
  userId: string,
  recipeId: string,
  // Optional only because feed.test.ts calls it with three arguments; pages always pass it.
  recipe: { slug: string; title: string } = { slug: "", title: "" },
): Promise<OwnRemixCard[]> {
  const { data, error } = await supabase
    .from("remixes")
    .select("id, recipe_id, status, challenge_id, changes, photo_path, created_at")
    .eq("recipe_id", recipeId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error || !Array.isArray(data)) return [];
  const rows = data as OwnRow[];
  const urls = await signRemixPhotos(supabase, rows.flatMap((r) => (r.photo_path ? [r.photo_path] : [])));
  return rows.map((r) => ({
    id: r.id,
    recipeId: r.recipe_id,
    recipeSlug: recipe.slug,
    recipeTitle: recipe.title,
    challengeId: r.challenge_id,
    changes: r.changes ?? "",
    authorName: "You",
    likeCount: 0,
    createdAt: r.created_at,
    photoUrl: r.photo_path ? (urls[r.photo_path] ?? null) : null,
    liked: false,
    status: r.status,
  }));
}

/** Marks the cards the viewer has liked (their own likes, read through RLS). */
export async function markLiked<T extends RemixCardData>(
  supabase: SupabaseClient,
  userId: string,
  cards: T[],
): Promise<T[]> {
  if (cards.length === 0) return cards;
  const { data } = await supabase
    .from("likes")
    .select("remix_id")
    .eq("user_id", userId)
    .in(
      "remix_id",
      cards.map((c) => c.id),
    );
  const liked = new Set(((data ?? []) as { remix_id: string }[]).map((l) => l.remix_id));
  return cards.map((c) => ({ ...c, liked: liked.has(c.id) }));
}
