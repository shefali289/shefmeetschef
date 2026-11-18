// Posting a remix, with injected deps so the order of checks is tested without Supabase.
import "server-only";
import { FREE_LIMITS, limitReachedText } from "@/lib/limits";
import type { Recipe } from "@/lib/types";
import { limitReachedError } from "@/lib/usage";
import { validateChanges } from "./changes";
import { isOwnPhotoPath, sniffImageType } from "./photo";
import type { PostRemixResult } from "./types";

export type RemixRecipe = Pick<Recipe, "id" | "slug" | "title" | "source" | "status">;
export type RemixInsertRow = { recipe_id: string; photo_path: string; changes: string };
export type DbError = { code?: string; message: string };

export interface PostRemixDeps {
  /** The recipe by slug, loaded on the server (null when unknown). */
  findRecipe: (slug: string) => Promise<RemixRecipe | null>;
  /** Downloads the uploaded photo with the user's session (null when missing). */
  download: (path: string) => Promise<Uint8Array | null>;
  /** Removes the user's uploaded photo. */
  removePhoto: (path: string) => Promise<void>;
  /** Inserts the remix with the user's session (RLS and the insert trigger apply). */
  insertRemix: (row: RemixInsertRow) => Promise<{ id: string } | { error: DbError }>;
  /** usage_remaining('remix', 5) for the counter. */
  remaining: () => Promise<number>;
  /** is_banned() for the signed-in user. */
  isBanned: () => Promise<boolean>;
}

export interface PostRemixInput {
  userId: string | null;
  slug: string;
  photoPath: unknown;
  changes: unknown;
}

export const REMIX_PENDING_TEXT = "Thanks! Waiting for a quick check. Shef's team will have a look soon.";
export const REMIX_BANNED_TEXT = "Sorry, you can't post remixes right now.";
export const REMIX_NOT_FOUND_TEXT = "We couldn't find that recipe. It may have been taken down.";
const PHOTO_MISSING = "We couldn't find your photo. Please choose it again.";
const PHOTO_NOT_IMAGE = "That file isn't a JPEG, PNG or WebP photo. Please choose another one.";
const TRY_AGAIN = "Something went wrong posting your remix. Please try again in a minute.";

const LIMIT = FREE_LIMITS.remix;

export async function postRemix(input: PostRemixInput, deps: PostRemixDeps): Promise<PostRemixResult> {
  const { userId } = input;
  if (!userId) return { status: "signed-out" };

  const changes = validateChanges(input.changes);
  const photoOk = isOwnPhotoPath(input.photoPath, userId);
  if (!changes.ok || !photoOk) {
    return {
      status: "invalid",
      errors: {
        ...(changes.ok ? {} : { changes: changes.error }),
        ...(photoOk ? {} : { photo: "Please choose a photo of your remix." }),
      },
    };
  }
  // A path in the user's own folder: safe to read and to clean up.
  const photoPath = input.photoPath as string;
  const fail = async (result: PostRemixResult): Promise<PostRemixResult> => {
    await deps.removePhoto(photoPath).catch(() => undefined);
    return result;
  };

  const recipe = await deps.findRecipe(input.slug).catch(() => undefined);
  if (recipe === undefined) return fail({ status: "error", message: TRY_AGAIN });
  if (!recipe || recipe.source !== "shef" || recipe.status !== "live") {
    return fail({ status: "not-found", message: REMIX_NOT_FOUND_TEXT });
  }

  const bytes = await deps.download(photoPath).catch(() => null);
  if (!bytes) return { status: "invalid", errors: { photo: PHOTO_MISSING } };
  if (!sniffImageType(bytes)) return fail({ status: "invalid", errors: { photo: PHOTO_NOT_IMAGE } });

  // Only these three: the trigger sets the user, status and challenge and spends the remix.
  const inserted = await deps.insertRemix({ recipe_id: recipe.id, photo_path: photoPath, changes: changes.value });
  if ("error" in inserted) {
    if (limitReachedError(inserted.error, "remix", LIMIT)) {
      return fail({ status: "limit", message: limitReachedText("remix", LIMIT), remaining: 0, limit: LIMIT });
    }
    if (await deps.isBanned().catch(() => false)) return fail({ status: "banned", message: REMIX_BANNED_TEXT });
    return fail({ status: "error", message: TRY_AGAIN });
  }

  const remaining = await deps.remaining().catch(() => 0);
  return { status: "pending", id: inserted.id, message: REMIX_PENDING_TEXT, remaining, limit: LIMIT };
}
