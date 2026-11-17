// Client-safe constants and types for outside reels (no server imports).

/** Longest caption accepted (Instagram's own caption limit). */
export const CAPTION_MAX_LENGTH = 2200;

export type AddReelResult =
  | { status: "invalid"; errors: { url?: string; caption?: string } }
  | { status: "limit"; message: string; remaining: 0; limit: number }
  | { status: "no-recipe"; message: string; remaining: number }
  | { status: "error"; message: string }
  | { status: "ok"; slug: string; remaining: number };

/** State for the /add-reel form (useActionState). */
export type AddReelFormState = AddReelResult | { status: "not-configured"; message: string } | null;
