// Client-safe types for remixes (no server imports).

/** remixes.status in the database. */
export type RemixStatus = "pending" | "approved" | "hidden";

/** Photo types a remix may use (the remix-photos bucket allows only these). */
export type PhotoType = "image/jpeg" | "image/png" | "image/webp";

/** One row of remix_feed(...) (slice A contract). like_count may arrive as a string (bigint). */
export interface RemixFeedRow {
  id: string;
  recipe_id: string;
  recipe_slug: string;
  recipe_title: string;
  challenge_id: string | null;
  changes: string;
  photo_path: string;
  author_name: string | null;
  like_count: number | string;
  created_at: string;
}

/** An approved remix as shown on a card. Never carries user_id or email. */
export interface RemixCardData {
  id: string;
  recipeId: string;
  recipeSlug: string;
  recipeTitle: string;
  challengeId: string | null;
  changes: string;
  /** First name, or "A home cook". */
  authorName: string;
  likeCount: number;
  createdAt: string;
  /** Short-lived signed URL, or null when the photo could not be signed (placeholder shown). */
  photoUrl: string | null;
  /** Whether the viewer has liked it. */
  liked: boolean;
}

/** The viewer's own remix, any status, read through their session. */
export interface OwnRemixCard extends RemixCardData {
  status: RemixStatus;
}

/** A page of the public feed. */
export interface RemixFeedPage {
  cards: RemixCardData[];
  page: number;
  hasMore: boolean;
}

/** Result of posting a remix (postRemix and postRemixAction). */
export type PostRemixResult =
  | { status: "signed-out" }
  | { status: "not-configured"; message: string }
  | { status: "invalid"; errors: { photo?: string; changes?: string } }
  | { status: "not-found"; message: string }
  | { status: "limit"; message: string; remaining: 0; limit: number }
  | { status: "banned"; message: string }
  | { status: "error"; message: string }
  | { status: "pending"; id: string; message: string; remaining: number; limit: number };

/** State for the remix form (useActionState). */
export type RemixFormState = PostRemixResult | null;

/** State for the like heart. */
export type LikeState = { ok?: boolean; liked?: boolean; error?: string };

/** State for delete-my-remix. */
export type RemixActionState = { ok?: boolean; error?: string };
