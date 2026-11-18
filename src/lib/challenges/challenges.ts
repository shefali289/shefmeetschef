// Challenge read model for server components. Reads through the given client, so RLS decides
// what is visible (anon sees live Shef base recipes only).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ANONYMOUS_AUTHOR, asUuid, loadRemixFeed } from "@/lib/remix/feed";
import { signRemixPhotos } from "@/lib/remix/photos";
import type { RemixFeedRow } from "@/lib/remix/types";
import { hasEnded, isOpen, nzToday } from "./dates";
import type { Challenge, ChallengeDetail, ChallengeList, ChallengeWinner } from "./types";

/** Past challenges listed on /challenges. */
const PAST_LIMIT = 50;

// challenges also reaches recipes through remixes, so the embed names its foreign key.
const COLUMNS =
  "id, base_recipe_id, title, description, starts_on, ends_on, winner_remix_id, base_recipe:recipes!base_recipe_id(id, slug, title)";

type ChallengeRow = {
  id: string;
  base_recipe_id: string | null;
  title: string;
  description: string | null;
  starts_on: string;
  ends_on: string;
  winner_remix_id: string | null;
  base_recipe: { id: string; slug: string; title: string } | null;
};

/**
 * Base recipe embed filters. On a to-one embed PostgREST keeps the challenge and gives null for a
 * recipe that fails them, so even an admin client (which can read drafts) never gets a draft's or
 * an outside recipe's slug.
 */
function liveBaseRecipe<T extends { filter: (column: string, operator: string, value: unknown) => T }>(query: T): T {
  return query.filter("base_recipe.source", "eq", "shef").filter("base_recipe.status", "eq", "live");
}

function toChallenge(row: ChallengeRow, winner: ChallengeWinner | null = null): Challenge {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    baseRecipeId: row.base_recipe_id,
    baseRecipeSlug: row.base_recipe?.slug ?? null,
    baseRecipeTitle: row.base_recipe?.title ?? null,
    winnerRemixId: row.winner_remix_id,
    winner,
  };
}

/** The winning remix, read directly, if it is still public (approved, live recipe, author not banned). */
async function loadWinner(supabase: SupabaseClient, row: ChallengeRow, signPhoto = true): Promise<ChallengeWinner | null> {
  if (!row.winner_remix_id) return null;
  // p_remix_id makes this at most one row; the id is still checked below.
  const { data, error } = await supabase.rpc("remix_feed", {
    p_challenge_id: row.id,
    p_remix_id: row.winner_remix_id,
  });
  if (error || !Array.isArray(data)) return null;
  const found = (data as RemixFeedRow[]).find((r) => r.id === row.winner_remix_id);
  if (!found) return null;
  const urls = signPhoto ? await signRemixPhotos(supabase, [found.photo_path]) : {};
  return {
    remixId: found.id,
    authorName: found.author_name?.trim() || ANONYMOUS_AUTHOR,
    photoUrl: urls[found.photo_path] ?? null,
  };
}

/** The open challenge (starts_on <= NZ today <= ends_on) with its base recipe, or null (also without Supabase). */
export async function getCurrentChallenge(supabase: SupabaseClient | null, today: string = nzToday()): Promise<Challenge | null> {
  if (!supabase) return null;
  const { data, error } = await liveBaseRecipe(supabase.from("challenges").select(COLUMNS))
    .lte("starts_on", today)
    .gte("ends_on", today)
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle<ChallengeRow>();
  if (error || !data) return null;
  return toChallenge(data);
}

/**
 * The open challenge, then ended ones newest first, each with its winner. Empty without Supabase.
 * opts.winnerPhotos false skips signing winner photos (for lists that do not show them).
 */
export async function listChallenges(
  supabase: SupabaseClient | null,
  today: string = nzToday(),
  opts: { winnerPhotos?: boolean } = {},
): Promise<ChallengeList> {
  if (!supabase) return { current: null, past: [] };
  const { data, error } = await liveBaseRecipe(supabase.from("challenges").select(COLUMNS))
    .lte("starts_on", today)
    .order("ends_on", { ascending: false })
    .limit(PAST_LIMIT + 1)
    .returns<ChallengeRow[]>();
  if (error || !Array.isArray(data)) return { current: null, past: [] };

  const currentRow = data.find((r) => isOpen({ startsOn: r.starts_on, endsOn: r.ends_on }, today));
  const pastRows = data.filter((r) => hasEnded({ endsOn: r.ends_on }, today)).slice(0, PAST_LIMIT);
  const past = await Promise.all(pastRows.map(async (r) => toChallenge(r, await loadWinner(supabase, r, opts.winnerPhotos ?? true))));
  return { current: currentRow ? toChallenge(currentRow) : null, past };
}

/**
 * One challenge with its approved entries (remix_feed by challenge): newest first, or by likes
 * when opts.admin. Null for an invalid or unknown id, or without Supabase.
 */
export async function getChallenge(
  supabase: SupabaseClient | null,
  id: string,
  opts: { admin?: boolean; today?: string } = {},
): Promise<ChallengeDetail | null> {
  const challengeId = asUuid(id);
  if (!supabase || !challengeId) return null;
  const today = opts.today ?? nzToday();
  const sort = opts.admin ? "likes" : "newest";

  const { data: row, error } = await liveBaseRecipe(supabase.from("challenges").select(COLUMNS))
    .eq("id", challengeId)
    .maybeSingle<ChallengeRow>();
  if (error || !row) return null;

  const feed = await loadRemixFeed(supabase, { challengeId, sort });
  const entries = feed.cards.map((card) => ({ ...card, isWinner: card.id === row.winner_remix_id }));
  const winnerCard = entries.find((e) => e.isWinner);
  const winner = winnerCard
    ? { remixId: winnerCard.id, authorName: winnerCard.authorName, photoUrl: winnerCard.photoUrl }
    : await loadWinner(supabase, row);

  const dates = { startsOn: row.starts_on, endsOn: row.ends_on };
  return {
    challenge: toChallenge(row, winner),
    entries,
    sort,
    open: isOpen(dates, today),
    ended: hasEnded(dates, today),
    hasMore: feed.hasMore,
  };
}
