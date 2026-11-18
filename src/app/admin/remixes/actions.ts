"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fields } from "@/app/cookbook/validation";
import { adminSignInPath } from "@/lib/auth/admin-sign-in";
import { NotAdminError, NotSignedInError } from "@/lib/auth/require-admin";
import { requireAdminClient } from "@/lib/auth/session";
import { SLUG_RE } from "@/lib/recipes";
import type { ModerationActionState } from "@/lib/remix/types";
import { supabaseConfig } from "@/lib/supabase/config";

const QUEUE_PATH = "/admin/remixes";
const ADMINS_ONLY = "Only Shef's admins can moderate remixes.";
const TRY_AGAIN = "Something went wrong. Please try again.";
const BAD_ID = "That remix or cook could not be found. Please refresh and try again.";

/**
 * The admin's own client (RLS and the functions' is_admin() check apply), or null for a signed-in
 * non-admin. Signed out goes to sign-in. Never the service-role client.
 */
async function adminClient(): Promise<SupabaseClient | null> {
  try {
    return (await requireAdminClient()).supabase;
  } catch (e) {
    if (e instanceof NotSignedInError && supabaseConfig()) redirect(adminSignInPath(QUEUE_PATH));
    if (e instanceof NotAdminError || e instanceof NotSignedInError) return null;
    throw e;
  }
}

const RemixForm = z.object({ remix_id: z.uuid(), recipe_slug: z.string().optional() });
const UserForm = z.object({ user_id: z.uuid() });
const BanForm = UserForm.extend({
  confirm: z.literal("yes", { error: "Please confirm the ban first." }),
  reason: z
    .string()
    .optional()
    .transform((r) => r?.trim().slice(0, 500) || null),
});

function friendly(error: { code?: string }): string {
  if (error.code === "42501") return ADMINS_ONLY;
  if (error.code === "SMM01") return "You can't ban an admin or yourself.";
  if (error.code === "SMM02") return "This cook is banned. Unban them first.";
  if (error.code === "P0002") return BAD_ID;
  return TRY_AGAIN;
}

function revalidateQueue(recipeSlug?: string) {
  revalidatePath(QUEUE_PATH);
  revalidatePath("/admin");
  revalidatePath("/remixes");
  if (recipeSlug && SLUG_RE.test(recipeSlug)) revalidatePath(`/recipes/${recipeSlug}`);
}

async function moderate(formData: FormData, action: "approve" | "hide"): Promise<ModerationActionState> {
  const supabase = await adminClient();
  if (!supabase) return { error: ADMINS_ONLY };
  const parsed = RemixForm.safeParse(fields(formData, ["remix_id", "recipe_slug"]));
  if (!parsed.success) return { error: BAD_ID };

  const { error } = await supabase.rpc("admin_moderate_remix", { p_remix_id: parsed.data.remix_id, p_action: action });
  if (error) return { error: friendly(error) };
  revalidateQueue(parsed.data.recipe_slug);
  return { ok: true, message: action === "approve" ? "Remix approved" : "Remix hidden" };
}

/** Fields: remix_id, recipe_slug (optional). Makes the remix live; old reports stop counting. */
export async function approveRemix(_prev: ModerationActionState, formData: FormData): Promise<ModerationActionState> {
  return moderate(formData, "approve");
}

/** Fields: remix_id, recipe_slug (optional). Hides the remix. */
export async function hideRemix(_prev: ModerationActionState, formData: FormData): Promise<ModerationActionState> {
  return moderate(formData, "hide");
}

/** Fields: user_id, reason (optional, up to 500), confirm ("yes"). Hides their remixes, removes their likes. */
export async function banUser(_prev: ModerationActionState, formData: FormData): Promise<ModerationActionState> {
  const supabase = await adminClient();
  if (!supabase) return { error: ADMINS_ONLY };
  const parsed = BanForm.safeParse(fields(formData, ["user_id", "reason", "confirm"]));
  if (!parsed.success) {
    return { error: parsed.error.issues.some((i) => i.path[0] === "user_id") ? BAD_ID : "Please confirm the ban first." };
  }

  const { error } = await supabase.rpc("admin_ban_user", { p_user_id: parsed.data.user_id, p_reason: parsed.data.reason });
  if (error) return { error: friendly(error) };
  revalidateQueue();
  revalidatePath("/recipes/[slug]", "page");
  return { ok: true, message: "Cook banned" };
}

/** Fields: user_id. Lifts the ban; their hidden remixes stay hidden. */
export async function unbanUser(_prev: ModerationActionState, formData: FormData): Promise<ModerationActionState> {
  const supabase = await adminClient();
  if (!supabase) return { error: ADMINS_ONLY };
  const parsed = UserForm.safeParse(fields(formData, ["user_id"]));
  if (!parsed.success) return { error: BAD_ID };

  const { error } = await supabase.rpc("admin_unban_user", { p_user_id: parsed.data.user_id });
  if (error) return { error: friendly(error) };
  revalidateQueue();
  revalidatePath("/recipes/[slug]", "page");
  return { ok: true, message: "Ban lifted" };
}
