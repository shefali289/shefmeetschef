// Free-tier limits and the copy that shows them. Client-safe (no server imports).
// The database enforces these; the numbers here are passed to consume_usage / saves_limit.
export const FREE_LIMITS = { ask: 10, outside_reel: 5, saves: 30, remix: 5 } as const;

/** Clamps a count to 0..limit so the UI never shows a negative or over-limit number. */
function clamp(n: number, limit: number): number {
  return Math.min(limit, Math.max(0, Math.floor(n)));
}

export function questionsLeftText(remaining: number, limit: number = FREE_LIMITS.ask): string {
  return `${clamp(remaining, limit)} of ${limit} questions left today`;
}

export function reelsLeftText(remaining: number, limit: number = FREE_LIMITS.outside_reel): string {
  return `${clamp(remaining, limit)} of ${limit} left this month`;
}

export function savesUsedText(used: number, limit: number = FREE_LIMITS.saves): string {
  return `${clamp(used, limit)} of ${limit} saves used`;
}

export function remixesLeftText(remaining: number, limit: number = FREE_LIMITS.remix): string {
  return `${clamp(remaining, limit)} of ${limit} remixes left today`;
}

/** Friendly message when a usage limit is reached; shared by the server results and the forms. */
export function limitReachedText(kind: "ask" | "outside_reel" | "remix", limitArg?: number): string {
  const limit = limitArg ?? FREE_LIMITS[kind];
  if (kind === "remix") return `That's all your remixes for today, come back tomorrow. ${remixesLeftText(0, limit)}.`;
  return kind === "ask"
    ? `That's all your questions for today, come back tomorrow. ${questionsLeftText(0, limit)}.`
    : `You've used all your reels for this month. ${reelsLeftText(0, limit)}.`;
}

/** Friendly message when the cookbook is full (the saves_limit_reached trigger fired). */
export function savesLimitReachedText(limit: number = FREE_LIMITS.saves): string {
  return `You've used ${limit} of ${limit} saves. Remove a recipe from your cookbook to make room.`;
}
