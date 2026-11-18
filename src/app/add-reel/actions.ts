"use server";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { parseCaption } from "@/lib/import/gemini-parser";
import { addReel } from "@/lib/outside/add-reel";
import type { AddReelFormState, AddReelResult } from "@/lib/outside/types";
import { consumeUsage, usageRemaining } from "@/lib/usage";

const NOT_CONFIGURED = "Adding outside reels is not set up yet. Check back soon!";
const SIGN_IN_PATH = `/sign-in?next=${encodeURIComponent("/add-reel")}`;

/** useActionState action for /add-reel. Form fields: url, caption. Redirects to the recipe on success. */
export async function addReelAction(_prev: AddReelFormState, formData: FormData): Promise<AddReelFormState> {
  const apiKey = process.env.GEMINI_API_KEY;
  const viewer = await getViewer();
  if (!viewer.configured || !viewer.supabase || !apiKey) {
    return { status: "not-configured", message: NOT_CONFIGURED };
  }
  if (!viewer.user) redirect(SIGN_IN_PATH);
  const { supabase, user } = { supabase: viewer.supabase, user: viewer.user };
  const url = formData.get("url");
  const caption = formData.get("caption");

  let result: AddReelResult;
  try {
    result = await addReel(
      {
        userId: user.id,
        url: typeof url === "string" ? url : "",
        caption: typeof caption === "string" ? caption : "",
      },
      {
        remaining: (kind, limit) => usageRemaining(supabase, kind, limit),
        consume: (kind, limit) => consumeUsage(supabase, kind, limit),
        parse: (text) => parseCaption(text, { apiKey, fetch }),
        insertRecipe: async (row) => {
          const { data, error } = await supabase.from("recipes").insert(row).select("id").single();
          if (error?.code === "23505") return "slug-taken";
          if (error || !data) throw new Error(`Could not save the recipe: ${error?.message}`);
          return { id: String((data as { id: unknown }).id) };
        },
        saveToCookbook: async (recipeId) => {
          // Unfiled. A failed save is not fatal: the recipe page is still theirs.
          await supabase.from("saves").insert({ user_id: user.id, recipe_id: recipeId, folder_id: null });
        },
      },
    );
  } catch {
    return { status: "error", message: "Something went wrong. Please try again in a minute." };
  }

  if (result.status === "ok") redirect(`/recipes/${result.slug}`);
  return result;
}
