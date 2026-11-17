// Client-safe types and limits for Ask Shef (no server imports).
import type { DietTag, Ingredient, Step } from "@/lib/types";

/** Longest question a user may ask. */
export const QUESTION_MAX_LENGTH = 500;
/** Longest answer kept from Gemini (longer answers are cut). */
export const ANSWER_MAX_LENGTH = 1500;
/** Earlier questions and answers sent with a follow-up (held in the browser only). */
export const HISTORY_MAX_TURNS = 3;

/**
 * Shef's modified version of the recipe on screen (e.g. "make it vegan"). Never stored in task 2.
 * Seam for task 3: a remix is saved from this shape.
 */
export interface ShefVersion {
  ingredients: Ingredient[];
  steps: Step[];
  diet_tags: DietTag[];
}

/** One earlier question and answer, sent back for follow-ups. */
export interface AskTurn {
  question: string;
  answer: string;
}

/** What Gemini gave back, after validation. */
export interface AskAnswer {
  answer: string;
  shefVersion: ShefVersion | null;
}

export type AskResult =
  | { status: "not-configured"; message: string }
  | { status: "signed-out" }
  | { status: "invalid"; message: string }
  | { status: "not-found"; message: string }
  | { status: "limit"; message: string; remaining: 0; limit: number }
  | { status: "error"; message: string }
  | {
      status: "ok";
      question: string;
      answer: string;
      shefVersion: ShefVersion | null;
      remaining: number;
      limit: number;
    };
