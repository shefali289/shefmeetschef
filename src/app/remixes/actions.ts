"use server";
import { z } from "zod";
import { cookbookUser } from "@/app/cookbook/action-auth";
import { fields, firstIssue, uuidField as id } from "@/app/cookbook/validation";
import { REMIX_PHOTOS_BUCKET } from "@/lib/remix/photos";
import { REMIX_NOT_CONFIGURED } from "@/lib/remix/status";
import type { LikeState, RemixActionState } from "@/lib/remix/types";
import { returnPath, revalidateRemixes as revalidate } from "./paths";

const TRY_AGAIN = "Something went wrong. Please try again in a minute.";
const CANT_LIKE = "You can't like this remix right now.";
const NO_REMIX = "We couldn't find that remix. It may already be deleted.";

const ToggleLike = z.object({ remix_id: id, intent: z.enum(["like", "unlike"]) });
const DeleteRemix = z.object({ remix_id: id });

/** Fields: remix_id, intent ("like" | "unlike"), return_to (optional same-site path). */
export async function toggleLike(_prev: LikeState, formData: FormData): Promise<LikeState> {
  const returnTo = returnPath(formData);
  const auth = await cookbookUser(returnTo);
  if (!auth) return { error: REMIX_NOT_CONFIGURED };
  const parsed = ToggleLike.safeParse(fields(formData, ["remix_id", "intent"]));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { supabase, user } = auth;
  const { remix_id, intent } = parsed.data;

  if (intent === "unlike") {
    const { error } = await supabase.from("likes").delete().eq("remix_id", remix_id).eq("user_id", user.id);
    if (error) return { liked: true, error: TRY_AGAIN };
    revalidate(returnTo);
    return { ok: true, liked: false };
  }

  // RLS allows likes on approved remixes only, never by banned users.
  const { error } = await supabase.from("likes").insert({ user_id: user.id, remix_id });
  // Already liked (primary key user_id, remix_id): that is what they wanted.
  if (error && error.code !== "23505") return { liked: false, error: error.code === "42501" ? CANT_LIKE : TRY_AGAIN };
  revalidate(returnTo);
  return { ok: true, liked: true };
}

/** Fields: remix_id, return_to (optional). Deletes the user's own remix, then its photo. */
export async function deleteRemix(_prev: RemixActionState, formData: FormData): Promise<RemixActionState> {
  const returnTo = returnPath(formData);
  const auth = await cookbookUser(returnTo);
  if (!auth) return { error: REMIX_NOT_CONFIGURED };
  const parsed = DeleteRemix.safeParse(fields(formData, ["remix_id"]));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { supabase, user } = auth;

  const { data, error } = await supabase
    .from("remixes")
    .delete()
    .eq("id", parsed.data.remix_id)
    .eq("user_id", user.id)
    .select("photo_path");
  if (error) return { error: "We couldn't delete that remix. Please try again." };
  const row = (data as { photo_path: string | null }[] | null)?.[0];
  if (!row) return { error: NO_REMIX };

  // After the row: Storage refuses to delete a photo a remix still uses. The path comes from the
  // deleted row, never from the browser. The day's remix is not given back.
  if (row.photo_path) await supabase.storage.from(REMIX_PHOTOS_BUCKET).remove([row.photo_path]);
  revalidate(returnTo);
  return { ok: true };
}
