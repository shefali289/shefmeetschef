"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { COOKBOOK_PATH, NOT_CONFIGURED, cookbookUser } from "./action-auth";
import { fields, firstIssue, uuidField } from "./validation";

export type ReelActionState = { ok?: boolean; error?: string };

const DeleteReel = z.object({ recipe_id: uuidField });

/**
 * Deletes one of the user's own outside reel recipes (its saves go with it). Only rows with
 * source = 'outside' owned by the session user match; RLS (recipes_delete_own_outside) checks
 * again. The month's reel allowance is not given back.
 */
export async function deleteReel(_prev: ReelActionState, formData: FormData): Promise<ReelActionState> {
  const auth = await cookbookUser();
  if (!auth) return { error: NOT_CONFIGURED };
  const parsed = DeleteReel.safeParse(fields(formData, ["recipe_id"]));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { data, error } = await auth.supabase
    .from("recipes")
    .delete()
    .eq("id", parsed.data.recipe_id)
    .eq("source", "outside")
    .eq("owner_id", auth.user.id)
    .select("id");
  if (error) return { error: "We couldn't delete that reel. Please try again." };
  if (!data || data.length === 0) return { error: "We couldn't find that reel. It may already be deleted." };
  revalidatePath(COOKBOOK_PATH);
  return { ok: true };
}
