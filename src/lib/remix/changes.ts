// "What I changed" text helpers. Client-safe.
import { z } from "zod";
import type { ShefVersion } from "@/lib/ask-shef/types";
import { ingredientText } from "@/lib/scaling";

/** Longest "what I changed" text (the database check is the same). */
export const CHANGES_MAX_LENGTH = 2000;

export type ChangesCheck = { ok: true; value: string } | { ok: false; error: string };

const EMPTY = "Tell us what you changed.";
const TOO_LONG = `Please keep what you changed to ${CHANGES_MAX_LENGTH} characters.`;

// String.trim() covers NBSP and BOM but not zero-width spaces, which would look empty on a card.
const INVISIBLE = /[\s​‌‍⁠﻿]/g;

const ChangesSchema = z
  .string({ error: EMPTY })
  .trim()
  .refine((s) => s.replace(INVISIBLE, "").length > 0, { error: EMPTY })
  .refine((s) => s.length <= CHANGES_MAX_LENGTH, { error: TOO_LONG });

/** Trims and accepts 1 to 2000 characters, refusing text that is only blank or invisible. */
export function validateChanges(text: unknown): ChangesCheck {
  const parsed = ChangesSchema.safeParse(text);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.issues[0].message };
}

/** Lists what Shef's version changed (ingredients and steps), at most 2000 characters. */
export function shefVersionToChanges(original: ShefVersion, version: ShefVersion): string {
  const before = new Set(original.ingredients.map(ingredientText));
  const steps = new Set(original.steps.map((s) => s.text.trim()));
  const lines = [
    "Shef's version:",
    ...version.ingredients.map(ingredientText).filter((t) => !before.has(t)).map((t) => `- ${t}`),
    ...version.steps.map((s) => s.text.trim()).filter((t) => t && !steps.has(t)).map((t) => `- ${t}`),
  ];
  let text = "";
  for (const line of lines) {
    const next = text ? `${text}\n${line}` : line;
    if (next.length > CHANGES_MAX_LENGTH) break;
    text = next;
  }
  return text;
}

const PREFILL_KEY = "shef-remix-prefill";

/** Keeps the prefill for one recipe in sessionStorage until the remix form reads it. */
export function saveRemixPrefill(slug: string, changes: string): void {
  try {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ slug, changes }));
  } catch {
    // Storage blocked (private mode): they can still type it in.
  }
}

/** Reads the prefill for this recipe once (and clears it); null when there is none. */
export function takeRemixPrefill(slug: string): string | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(PREFILL_KEY) ?? "null") as unknown;
    if (!stored || typeof stored !== "object") return null;
    const { slug: s, changes } = stored as { slug?: unknown; changes?: unknown };
    if (s !== slug || typeof changes !== "string") return null;
    sessionStorage.removeItem(PREFILL_KEY);
    return changes;
  } catch {
    return null;
  }
}
