import type { DraftRecipe, NoRecipe } from "@/lib/import/gemini-parser";
import { DRAFT_LIMITS as L } from "@/lib/draft-limits";
import { slugify } from "@/lib/import/slug";
import { instagramCanonicalUrl } from "@/lib/embed";
import { FREE_LIMITS, limitReachedText } from "@/lib/limits";
import type { Recipe } from "@/lib/types";
import { LimitReachedError, type UsageKind } from "@/lib/usage";
import { z } from "zod";
import { CAPTION_MAX_LENGTH, type AddReelResult } from "./types";

export { CAPTION_MAX_LENGTH };
export type { AddReelFormState, AddReelResult } from "./types";

/** Row inserted into recipes for an outside reel (the DB generates id). */
export type OutsideRecipeRow = Omit<Recipe, "id" | "published_at"> & {
  source: "outside";
  status: "live";
  owner_id: string;
  instagram_id: null;
  youtube_id: null;
  youtube_url: null;
  cover_image_url: null;
};

export interface AddReelDeps {
  /** usage_remaining (does not consume). */
  remaining: (kind: UsageKind, limit: number) => Promise<number>;
  /** consume_usage; throws LimitReachedError when a parallel request used the last one. */
  consume: (kind: UsageKind, limit: number) => Promise<number>;
  /** Gemini caption parser. */
  parse: (caption: string) => Promise<DraftRecipe | NoRecipe>;
  /** Inserts the row; "slug-taken" on a unique slug violation. */
  insertRecipe: (row: OutsideRecipeRow) => Promise<{ id: string } | "slug-taken">;
  /** Saves the recipe unfiled into the user's cookbook. */
  saveToCookbook: (recipeId: string) => Promise<void>;
  /** 6 random lowercase letters/digits; injectable for tests. */
  randomSuffix?: () => string;
}

export interface AddReelInput {
  userId: string;
  url: string;
  caption: string;
}

const SLUG_TRIES = 5;
/** Matches the outside-recipe checks in the database. */
const MAX_TAGS = 20;
const MAX_CUISINE = 40;
const SLUG_TITLE_MAX = 60;
const TRY_AGAIN = "Shef couldn't read that caption just now. Please try again in a minute.";

const CaptionSchema = z
  .string({ error: "Paste the caption with the recipe." })
  .trim()
  .min(1, "Paste the caption with the recipe.")
  .max(CAPTION_MAX_LENGTH, `Captions can be up to ${CAPTION_MAX_LENGTH} characters.`);

const SUFFIX_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 6 random lowercase letters and digits from a CSPRNG. */
export function randomSlugSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => SUFFIX_CHARS[b % SUFFIX_CHARS.length]).join("");
}

/** reel-<title>-<suffix>, so outside slugs never take a slug Shef may want later. */
function outsideSlug(title: string, suffix: string): string {
  const base = slugify(title).slice(0, SLUG_TITLE_MAX).replace(/-+$/g, "");
  return `reel-${base}-${suffix}`;
}

function limitResult(limit: number): AddReelResult {
  return {
    status: "limit",
    message: limitReachedText("outside_reel", limit),
    remaining: 0,
    limit,
  };
}

/**
 * Turns a pasted reel link and caption into a private recipe card. A reel is only spent once a
 * recipe is found; "no recipe" and Gemini failures cost nothing.
 */
export async function addReel(input: AddReelInput, deps: AddReelDeps): Promise<AddReelResult> {
  const errors: { url?: string; caption?: string } = {};
  const reelUrl = typeof input.url === "string" ? instagramCanonicalUrl(input.url.trim()) : null;
  if (!reelUrl) errors.url = "Paste an Instagram reel or post link.";
  const parsedCaption = CaptionSchema.safeParse(input.caption);
  if (!parsedCaption.success) errors.caption = parsedCaption.error.issues[0].message;
  if (!reelUrl || !parsedCaption.success) return { status: "invalid", errors };
  const caption = parsedCaption.data;

  const limit = FREE_LIMITS.outside_reel;
  const left = await deps.remaining("outside_reel", limit);
  if (left <= 0) return limitResult(limit);

  let draft: DraftRecipe | NoRecipe;
  try {
    draft = await deps.parse(caption);
  } catch {
    return { status: "error", message: TRY_AGAIN };
  }
  if ("noRecipe" in draft) {
    return {
      status: "no-recipe",
      message: "No recipe found in that caption. That didn't use up a reel.",
      remaining: left,
    };
  }

  let remaining: number;
  try {
    remaining = await deps.consume("outside_reel", limit);
  } catch (e) {
    if (e instanceof LimitReachedError) return limitResult(limit);
    return { status: "error", message: TRY_AGAIN };
  }

  const suffix = deps.randomSuffix ?? randomSlugSuffix;
  const base = {
    // Capped again here to match the database checks, whatever the parser returned.
    title: draft.title.slice(0, L.title),
    description: draft.description?.slice(0, L.description) ?? null,
    reel_url: reelUrl,
    youtube_url: null,
    cover_image_url: null,
    source: "outside",
    ingredients: draft.ingredients.slice(0, L.ingredients),
    steps: draft.steps.slice(0, L.steps),
    base_servings: draft.base_servings,
    prep_minutes: draft.prep_minutes,
    cook_minutes: draft.cook_minutes,
    cuisine: draft.cuisine?.slice(0, MAX_CUISINE) ?? null,
    diet_tags: draft.diet_tags.slice(0, MAX_TAGS),
    allergens: draft.allergens.slice(0, MAX_TAGS),
    categories: draft.categories.slice(0, MAX_TAGS),
    status: "live",
    owner_id: input.userId,
    instagram_id: null,
    youtube_id: null,
  } as const;

  // The reel is already spent here. If the insert fails for any reason other than a slug clash
  // (or every try clashes), that reel is lost for the month; usage is not refunded.
  for (let i = 0; i < SLUG_TRIES; i++) {
    const slug = outsideSlug(draft.title, suffix());
    const inserted = await deps.insertRecipe({ ...base, slug });
    if (inserted === "slug-taken") continue;
    await deps.saveToCookbook(inserted.id);
    return { status: "ok", slug, remaining };
  }
  return { status: "error", message: "Something went wrong saving that recipe. Please try again." };
}
