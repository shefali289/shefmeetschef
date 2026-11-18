import "server-only";
import { z } from "zod";
import { FREE_LIMITS, limitReachedText } from "@/lib/limits";
import { SLUG_RE } from "@/lib/recipes";
import type { Recipe } from "@/lib/types";
import { LimitReachedError, type UsageKind } from "@/lib/usage";
import {
  ANSWER_MAX_LENGTH,
  HISTORY_MAX_TURNS,
  QUESTION_MAX_LENGTH,
  type AskAnswer,
  type AskResult,
  type AskTurn,
} from "./types";

export interface RunAskDeps {
  /** The signed-in user, or null. */
  getUser: () => Promise<{ id: string } | null>;
  /** Loads the recipe on the server (RLS applies), or null when not visible. */
  loadRecipe: (slug: string) => Promise<Recipe | null>;
  /** consume_usage; throws LimitReachedError when over the limit. Returns remaining. */
  consume: (kind: UsageKind, limit: number) => Promise<number>;
  /** Calls Gemini. */
  ask: (input: { recipe: Recipe; question: string; history: AskTurn[] }) => Promise<AskAnswer>;
}

export interface RunAskInput {
  slug: string;
  question: string;
  /** Untrusted, from the browser. */
  history?: unknown;
}

const NOT_FOUND = "We couldn't find that recipe.";
const TRY_AGAIN = "Shef couldn't answer just now. Please try again in a minute.";

const EMPTY_QUESTION = "Type a question for Shef first.";
const LONG_QUESTION = `Please keep your question under ${QUESTION_MAX_LENGTH} characters.`;

const QuestionSchema = z
  .string({ error: EMPTY_QUESTION })
  .trim()
  .min(1, EMPTY_QUESTION)
  .max(QUESTION_MAX_LENGTH, LONG_QUESTION);

/** One earlier turn; anything malformed is dropped rather than failing the whole question. */
const TurnSchema = z.object({
  question: z.string().transform((v) => v.slice(0, QUESTION_MAX_LENGTH)),
  answer: z.string().transform((v) => v.slice(0, ANSWER_MAX_LENGTH)),
});

const HistorySchema = z
  .array(z.unknown())
  .transform((turns) =>
    turns
      .flatMap((t) => {
        const parsed = TurnSchema.safeParse(t);
        return parsed.success ? [parsed.data] : [];
      })
      .slice(-HISTORY_MAX_TURNS),
  )
  .catch([]);

/** Keeps the last few well-formed turns from browser-held history, each capped in length. */
export function cleanHistory(history: unknown): AskTurn[] {
  return HistorySchema.parse(history);
}

/**
 * Ask Shef, server side: validate, check the user, load the recipe by slug (never trusting the
 * browser for its text), consume one question, then call Gemini.
 */
export async function runAsk(input: RunAskInput, deps: RunAskDeps): Promise<AskResult> {
  const parsedQuestion = QuestionSchema.safeParse(input.question);
  if (!parsedQuestion.success) {
    return { status: "invalid", message: parsedQuestion.error.issues[0].message };
  }
  const question = parsedQuestion.data;

  const user = await deps.getUser();
  if (!user) return { status: "signed-out" };

  const slug = typeof input.slug === "string" ? input.slug : "";
  const recipe = SLUG_RE.test(slug) ? await deps.loadRecipe(slug) : null;
  if (!recipe) return { status: "not-found", message: NOT_FOUND };

  const limit = FREE_LIMITS.ask;
  let remaining: number;
  try {
    remaining = await deps.consume("ask", limit);
  } catch (e) {
    if (e instanceof LimitReachedError) {
      return {
        status: "limit",
        message: limitReachedText("ask", limit),
        remaining: 0,
        limit,
      };
    }
    return { status: "error", message: TRY_AGAIN };
  }

  try {
    const { answer, shefVersion } = await deps.ask({
      recipe,
      question,
      history: cleanHistory(input.history),
    });
    return { status: "ok", question, answer, shefVersion, remaining, limit };
  } catch {
    return { status: "error", message: TRY_AGAIN };
  }
}
