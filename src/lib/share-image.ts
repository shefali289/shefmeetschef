import { youtubeThumbnailUrl } from "./embed";
import type { Recipe } from "./types";

/** Image for search and social cards: cover photo, else YouTube thumbnail, else the branded default. */
export function shareImage(
  recipe: Pick<Recipe, "cover_image_url" | "youtube_url">,
  siteUrl: string,
): string {
  if (recipe.cover_image_url) return recipe.cover_image_url;
  const thumb = recipe.youtube_url ? youtubeThumbnailUrl(recipe.youtube_url) : null;
  return thumb ?? `${siteUrl.replace(/\/+$/, "")}/og-default.png`;
}
