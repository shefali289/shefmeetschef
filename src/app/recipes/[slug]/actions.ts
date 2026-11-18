"use server";
import { askShef } from "@/lib/ask-shef/ask-shef";
import { runAsk } from "@/lib/ask-shef/run-ask";
import type { AskResult } from "@/lib/ask-shef/types";
import { getViewer } from "@/lib/auth/session";
import { getRecipeForViewer } from "@/lib/recipes";
import { consumeUsage } from "@/lib/usage";

const NOT_CONFIGURED = "Ask Shef is not set up yet. Check back soon!";

function parseHistory(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || !value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

/** useActionState action for Ask Shef. Form fields: slug, question, history (JSON of AskTurn[]). */
export async function askShefAction(_prev: AskResult | null, formData: FormData): Promise<AskResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  const viewer = await getViewer();
  if (!viewer.configured || !viewer.supabase || !apiKey) {
    return { status: "not-configured", message: NOT_CONFIGURED };
  }
  const supabase = viewer.supabase;
  const slug = formData.get("slug");
  const question = formData.get("question");

  return runAsk(
    {
      slug: typeof slug === "string" ? slug : "",
      question: typeof question === "string" ? question : "",
      history: parseHistory(formData.get("history")),
    },
    {
      getUser: async () => viewer.user,
      // The recipe is loaded here by slug through the user's session, never sent by the browser.
      loadRecipe: (s) => getRecipeForViewer(s, supabase, viewer.user?.id ?? null),
      consume: (kind, limit) => consumeUsage(supabase, kind, limit),
      ask: (input) => askShef(input, { apiKey, fetch }),
    },
  );
}
