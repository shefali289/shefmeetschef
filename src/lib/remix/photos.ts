import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Signed URL lifetime: 1 hour. */
export const REMIX_PHOTO_URL_SECONDS = 3600;

export const REMIX_PHOTOS_BUCKET = "remix-photos";

type Signed = { path: string | null; signedUrl: string | null; error: string | null };

/**
 * Signs each path with the given client (the visitor's own session, so the storage select rule
 * decides which photos may be seen); a path that cannot be signed maps to null. Never throws.
 */
export async function signRemixPhotos(
  supabase: SupabaseClient,
  paths: string[],
): Promise<Record<string, string | null>> {
  const unique = [...new Set(paths)];
  const urls: Record<string, string | null> = Object.fromEntries(unique.map((p) => [p, null]));
  if (unique.length === 0) return urls;
  try {
    const { data, error } = await supabase.storage
      .from(REMIX_PHOTOS_BUCKET)
      .createSignedUrls(unique, REMIX_PHOTO_URL_SECONDS);
    if (error || !data) return urls;
    for (const item of data as Signed[]) {
      if (item.path && Object.hasOwn(urls, item.path) && !item.error && item.signedUrl) {
        urls[item.path] = item.signedUrl;
      }
    }
  } catch {
    // Storage is down: the cards show placeholders.
  }
  return urls;
}
