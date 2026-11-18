"use server";
import { revalidatePath } from "next/cache";
import { cookbookUser } from "@/app/cookbook/action-auth";
import { FREE_LIMITS } from "@/lib/limits";
import { getRecipeBySlug, SLUG_RE } from "@/lib/recipes";
import { REMIX_PHOTOS_BUCKET } from "@/lib/remix/photos";
import { postRemix, REMIX_NOT_FOUND_TEXT } from "@/lib/remix/post-remix";
import { REMIX_NOT_CONFIGURED } from "@/lib/remix/status";
import type { RemixFormState } from "@/lib/remix/types";
import { usageRemaining } from "@/lib/usage";

/** Form fields: slug, photo_path (already uploaded to the user's folder), changes. */
export async function postRemixAction(_prev: RemixFormState, formData: FormData): Promise<RemixFormState> {
  const slug = formData.get("slug");
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) return { status: "not-found", message: REMIX_NOT_FOUND_TEXT };
  const auth = await cookbookUser(`/recipes/${slug}/remix`);
  if (!auth) return { status: "not-configured", message: REMIX_NOT_CONFIGURED };
  const { supabase, user } = auth;
  const photos = supabase.storage.from(REMIX_PHOTOS_BUCKET);

  const result = await postRemix(
    { userId: user.id, slug, photoPath: formData.get("photo_path"), changes: formData.get("changes") },
    {
      findRecipe: getRecipeBySlug,
      download: async (path) => {
        const { data, error } = await photos.download(path);
        return error || !data ? null : new Uint8Array(await data.arrayBuffer());
      },
      removePhoto: async (path) => {
        await photos.remove([path]);
      },
      insertRemix: async (row) => {
        const { data, error } = await supabase.from("remixes").insert(row).select("id").single<{ id: string }>();
        return error || !data ? { error: error ?? { message: "no row" } } : { id: data.id };
      },
      remaining: () => usageRemaining(supabase, "remix", FREE_LIMITS.remix),
      isBanned: async () => (await supabase.rpc("is_banned")).data === true,
    },
  );

  if (result.status === "pending") {
    revalidatePath(`/recipes/${slug}`);
    revalidatePath("/remixes");
  }
  return result;
}
