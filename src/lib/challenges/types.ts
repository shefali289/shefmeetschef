// Client-safe types for weekly challenges (no server imports). Stub written by the tester for
// task 3 slice C; the implementer may add fields but must keep these names and shapes.
import type { RemixCardData } from "@/lib/remix/types";

/** The winning remix of a challenge, as shown in lists. */
export interface ChallengeWinner {
  remixId: string;
  /** First name, or "A home cook". */
  authorName: string;
  /** Short-lived signed URL, or null (placeholder shown). */
  photoUrl: string | null;
}

/** One challenge row, camel-cased, with its base recipe (null when it is not a live Shef recipe). */
export interface Challenge {
  id: string;
  title: string;
  description: string | null;
  /** NZ dates, YYYY-MM-DD, inclusive. */
  startsOn: string;
  endsOn: string;
  baseRecipeId: string | null;
  baseRecipeSlug: string | null;
  baseRecipeTitle: string | null;
  winnerRemixId: string | null;
  /** Filled when the winner is set and is still a public remix; null otherwise. */
  winner: ChallengeWinner | null;
}

/** An approved entry on the challenge page. */
export interface ChallengeEntry extends RemixCardData {
  isWinner: boolean;
}

/** /challenges: the open challenge (if any) and the ended ones, newest first. Upcoming ones are not listed. */
export interface ChallengeList {
  current: Challenge | null;
  past: Challenge[];
}

/** /challenges/[id]. */
export interface ChallengeDetail {
  challenge: Challenge;
  /** Approved entries only: newest first for visitors, by likes for the admin. */
  entries: ChallengeEntry[];
  sort: "newest" | "likes";
  /** starts_on <= NZ today <= ends_on. */
  open: boolean;
  /** NZ today > ends_on (a winner may be picked). */
  ended: boolean;
  /**
   * More approved entries than one page: the rest are on /remixes?challenge=<id>. getChallenge
   * always sets it; optional only so test fixtures written before it still type-check.
   */
  hasMore?: boolean;
}

/** State for the admin's create-challenge form (useActionState). */
export type ChallengeFormField = "title" | "description" | "base_recipe_id" | "starts_on" | "ends_on" | "form";
export type ChallengeFormState = {
  ok?: boolean;
  id?: string;
  errors?: Partial<Record<ChallengeFormField, string>>;
} | null;

/** State for Pick as winner. */
export type PickWinnerState = { ok?: boolean; error?: string } | null;

/** Shown wherever challenges need Supabase and it is not set up. */
export const CHALLENGES_NOT_CONFIGURED = "Challenges are not set up yet. Check back soon!";
