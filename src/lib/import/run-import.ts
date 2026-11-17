import "server-only";
import type { Recipe } from "@/lib/types";
import { DraftValidationError, type DraftRecipe, type NoRecipe } from "./gemini-parser";
import type { InstagramPost } from "./instagram";
import type { YouTubePost } from "./youtube";
import { uniqueSlug } from "./slug";

/** Row handed to saveDraft (the DB generates id; published_at stays null for drafts). */
export type DraftRow = Omit<Recipe, "id"> & {
  instagram_id: string | null;
  youtube_id: string | null;
};

export type ImportSource = "instagram" | "youtube";

export interface ExistingIds {
  instagram: Set<string>;
  youtube: Set<string>;
  slugs: Set<string>;
  /** Posts recorded earlier with recordSkip; they are not parsed again. */
  skipped?: { instagram: Set<string>; youtube: Set<string> };
}

export interface SkipRecord {
  source: ImportSource;
  id: string;
  reason: "no_recipe" | "failed";
}

/** Default Gemini calls per run, to stay inside free-tier rate limits and request timeouts. */
// Kept small so one run stays inside Netlify's function time limit and Gemini's free rate limit.
export const DEFAULT_MAX_PARSES = 3;

export interface ImportDeps {
  fetchInstagram: () => Promise<InstagramPost[]>;
  /** Undefined when YouTube is not configured. */
  fetchYouTube?: () => Promise<YouTubePost[]>;
  parseCaption: (caption: string) => Promise<DraftRecipe | NoRecipe>;
  existingIds: () => Promise<ExistingIds>;
  saveDraft: (row: DraftRow) => Promise<void>;
  /** Remembers posts with no recipe or a failed parse, so later runs skip them. */
  recordSkip: (skip: SkipRecord) => Promise<void>;
  /** Most parseCaption calls per run (default 5). */
  maxParses?: number;
}

export interface ImportRef {
  source: ImportSource;
  id: string;
  url: string;
}

export interface ImportSummary {
  /** Number of drafts saved. */
  imported: number;
  /** Number of posts skipped because they were already imported or recorded as skipped. */
  skipped: number;
  /** New posts left for a later run (over maxParses). */
  remaining: number;
  /** Posts whose caption had no recipe. */
  noRecipe: ImportRef[];
  /** Posts that failed to parse or save; one failure never stops the rest. */
  failed: (ImportRef & { error: string })[];
  /** A source whose fetch failed; the other source still imports. */
  sourceErrors: { source: ImportSource; error: string }[];
}

interface Candidate {
  ref: ImportRef;
  caption: string;
  instagram_id: string | null;
  youtube_id: string | null;
  reel_url: string | null;
  youtube_url: string | null;
  cover_image_url: string | null;
}

function fromInstagram(p: InstagramPost): Candidate {
  return {
    ref: { source: "instagram", id: p.instagram_id, url: p.permalink },
    caption: p.caption,
    instagram_id: p.instagram_id,
    youtube_id: null,
    reel_url: p.permalink,
    youtube_url: null,
    cover_image_url: p.thumbnail_url,
  };
}

function fromYouTube(p: YouTubePost): Candidate {
  return {
    ref: { source: "youtube", id: p.youtube_id, url: p.url },
    caption: `${p.title}\n\n${p.description}`,
    instagram_id: null,
    youtube_id: p.youtube_id,
    reel_url: null,
    youtube_url: p.url,
    cover_image_url: p.thumbnail_url,
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Imports new Instagram and YouTube posts as drafts. Already imported or skipped posts are left
 * out before Gemini is called, at most maxParses posts are parsed, and one failing post or source
 * never stops the rest.
 */
export async function runImport(deps: ImportDeps): Promise<ImportSummary> {
  const [existing, [igResult, ytResult]] = await Promise.all([
    deps.existingIds(),
    Promise.all([
      Promise.allSettled([deps.fetchInstagram()]),
      Promise.allSettled([deps.fetchYouTube ? deps.fetchYouTube() : []]),
    ]).then(([[ig], [yt]]) => [ig, yt] as const),
  ]);
  const summary: ImportSummary = {
    imported: 0,
    skipped: 0,
    remaining: 0,
    noRecipe: [],
    failed: [],
    sourceErrors: [],
  };
  const settledPosts = <T>(source: ImportSource, r: PromiseSettledResult<T[]>): T[] => {
    if (r.status === "fulfilled") return r.value;
    summary.sourceErrors.push({ source, error: message(r.reason) });
    return [];
  };

  const slugs = new Set(existing.slugs);
  const known = {
    instagram: new Set([...existing.instagram, ...(existing.skipped?.instagram ?? [])]),
    youtube: new Set([...existing.youtube, ...(existing.skipped?.youtube ?? [])]),
  };

  const candidates: Candidate[] = [];
  for (const c of [
    ...settledPosts("instagram", igResult).map(fromInstagram),
    ...settledPosts("youtube", ytResult).map(fromYouTube),
  ]) {
    if (known[c.ref.source].has(c.ref.id)) summary.skipped++;
    else candidates.push(c);
  }

  const maxParses = Math.max(0, deps.maxParses ?? DEFAULT_MAX_PARSES);
  const batch = candidates.slice(0, maxParses);
  summary.remaining = candidates.length - batch.length;

  const recordSkip = async (ref: ImportRef, reason: SkipRecord["reason"]) => {
    try {
      await deps.recordSkip({ source: ref.source, id: ref.id, reason });
    } catch {
      // Not fatal: the post is simply tried again next run.
    }
  };

  for (const c of batch) {
    let parsed: DraftRecipe | NoRecipe;
    try {
      parsed = await deps.parseCaption(c.caption);
    } catch (e) {
      summary.failed.push({ ...c.ref, error: message(e) });
      // Only a caption Gemini cannot turn into a valid recipe is skipped for good. Rate limits,
      // timeouts and server errors are left unrecorded so the next run tries the post again.
      if (e instanceof DraftValidationError) await recordSkip(c.ref, "failed");
      continue;
    }
    if ("noRecipe" in parsed) {
      summary.noRecipe.push(c.ref);
      await recordSkip(c.ref, "no_recipe");
      continue;
    }
    const slug = uniqueSlug(parsed.title, slugs);
    slugs.add(slug);
    try {
      await deps.saveDraft({
        ...parsed,
        slug,
        source: "shef",
        status: "draft",
        published_at: null,
        instagram_id: c.instagram_id,
        youtube_id: c.youtube_id,
        reel_url: c.reel_url,
        youtube_url: c.youtube_url,
        cover_image_url: c.cover_image_url,
      });
      summary.imported++;
    } catch (e) {
      summary.failed.push({ ...c.ref, error: message(e) });
    }
  }
  return summary;
}
