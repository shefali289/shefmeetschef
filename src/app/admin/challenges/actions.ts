"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adminSignInPath } from "@/lib/auth/admin-sign-in";
import { NotAdminError, NotSignedInError } from "@/lib/auth/require-admin";
import { requireAdminClient } from "@/lib/auth/session";
import { defaultChallengeWeek } from "@/lib/challenges/dates";
import type { ChallengeFormField, ChallengeFormState, PickWinnerState } from "@/lib/challenges/types";
import { supabaseConfig } from "@/lib/supabase/config";

const TRY_AGAIN = "Something went wrong. Please try again.";

/** The admin's own client (RLS applies), or null for a signed-in non-admin. Signed-out goes to sign-in. */
async function adminClient(): Promise<SupabaseClient | null> {
  try {
    return (await requireAdminClient()).supabase;
  } catch (e) {
    if (e instanceof NotSignedInError && supabaseConfig()) redirect(adminSignInPath("/admin/challenges"));
    if (e instanceof NotAdminError) return null;
    throw e;
  }
}

const field = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

/** A real calendar date written YYYY-MM-DD. */
const isoDate = z.iso.date("Use a real date.");

const challengeSchema = z
  .object({
    title: z.string().trim().min(1, "Give the challenge a title.").max(200, "Keep the title to 200 characters."),
    description: z
      .string()
      .trim()
      .max(2000, "Keep the description to 2000 characters.")
      .transform((d) => d || null),
    base_recipe_id: z.guid("Choose a base recipe."),
    starts_on: isoDate,
    ends_on: isoDate,
  })
  .refine((c) => c.ends_on >= c.starts_on, { path: ["ends_on"], message: "End on or after the start date." });

function revalidateChallenge(id: string) {
  revalidatePath("/");
  revalidatePath("/challenges");
  revalidatePath(`/challenges/${id}`);
}

/** useActionState action for ChallengeForm: validates (zod) and creates a challenge with the admin's client. */
export async function createChallenge(_prev: ChallengeFormState, formData: FormData): Promise<ChallengeFormState> {
  const supabase = await adminClient();
  if (!supabase) return { errors: { form: "Only Shef's admins can create challenges." } };

  const week = defaultChallengeWeek();
  const parsed = challengeSchema.safeParse({
    title: field(formData.get("title")),
    description: field(formData.get("description")),
    base_recipe_id: field(formData.get("base_recipe_id")),
    starts_on: field(formData.get("starts_on")).trim() || week.startsOn,
    ends_on: field(formData.get("ends_on")).trim() || week.endsOn,
  });
  if (!parsed.success) {
    const errors: Partial<Record<ChallengeFormField, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as ChallengeFormField;
      errors[key] ??= issue.message;
    }
    return { errors };
  }

  const { data, error } = await supabase.from("challenges").insert(parsed.data).select("id").single<{ id: string }>();
  if (error || !data) {
    if (error?.code === "SMC01") return { errors: { base_recipe_id: "Choose a live Shef recipe." } };
    if (error?.code === "23P01") {
      return { errors: { starts_on: "These dates overlap another challenge. Pick another week." } };
    }
    return { errors: { form: TRY_AGAIN } };
  }

  revalidateChallenge(data.id);
  revalidatePath("/admin/challenges");
  revalidatePath("/recipes/[slug]", "page");
  return { ok: true, id: data.id };
}

const pickSchema = z.object({ challenge_id: z.guid(), remix_id: z.guid() });

/** useActionState action for Pick as winner (challenge_id, remix_id) with the admin's client. */
export async function pickWinner(_prev: PickWinnerState, formData: FormData): Promise<PickWinnerState> {
  const supabase = await adminClient();
  if (!supabase) return { error: "Only Shef's admins can pick a winner." };

  const parsed = pickSchema.safeParse({
    challenge_id: field(formData.get("challenge_id")),
    remix_id: field(formData.get("remix_id")),
  });
  if (!parsed.success) return { error: "That entry could not be found." };
  const { challenge_id, remix_id } = parsed.data;

  const { data, error } = await supabase
    .from("challenges")
    .update({ winner_remix_id: remix_id })
    .eq("id", challenge_id)
    .select("id");
  if (error) {
    if (error.code === "SMC02") return { error: "You can pick a winner once the challenge has ended." };
    if (error.code === "SMC03") return { error: "The winner must be an approved entry of this challenge." };
    return { error: TRY_AGAIN };
  }
  if (!data || data.length === 0) return { error: "That challenge could not be found." };

  revalidateChallenge(challenge_id);
  revalidatePath("/admin/challenges");
  return { ok: true };
}
