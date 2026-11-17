"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminSignInPath } from "@/lib/auth/admin-sign-in";
import { NotSignedInError } from "@/lib/auth/require-admin";
import { requireAdminClient } from "@/lib/auth/session";
import { parseDraftForm, type DraftFormState } from "@/lib/draft-form";
import { copyCoverToStorage } from "@/lib/import/copy-cover";
import { parseCaption } from "@/lib/import/gemini-parser";
import { fetchInstagramMedia } from "@/lib/import/instagram";
import { runImport, type DraftRow, type ExistingIds, type SkipRecord } from "@/lib/import/run-import";
import { fetchYouTubeUploads } from "@/lib/import/youtube";
import { supabaseConfig } from "@/lib/supabase/config";
import { writeLastImportCookie, type LastImportInput } from "./last-import";

const INSTAGRAM_LIMIT = 50;

function revalidateRecipes() {
  revalidatePath("/");
  revalidatePath("/recipes");
  revalidatePath("/recipes/[slug]", "page");
  revalidatePath("/admin", "layout");
}

/** The admin's own client (RLS applies). Signed-out visitors go to sign-in; others get an error. */
async function adminClientOr(returnTo: string): Promise<SupabaseClient> {
  try {
    return (await requireAdminClient()).supabase;
  } catch (e) {
    if (e instanceof NotSignedInError && supabaseConfig()) redirect(adminSignInPath(returnTo));
    throw e;
  }
}

async function existingIds(supabase: SupabaseClient): Promise<ExistingIds> {
  const [recipes, skips] = await Promise.all([
    supabase.from("recipes").select("instagram_id, youtube_id, slug"),
    supabase.from("import_skips").select("source, external_id"),
  ]);
  if (recipes.error) throw new Error(`Could not read existing recipes: ${recipes.error.message}`);
  if (skips.error) throw new Error(`Could not read import skips: ${skips.error.message}`);
  const ids: ExistingIds = {
    instagram: new Set(),
    youtube: new Set(),
    slugs: new Set(),
    skipped: { instagram: new Set(), youtube: new Set() },
  };
  for (const row of recipes.data ?? []) {
    if (row.instagram_id) ids.instagram.add(row.instagram_id);
    if (row.youtube_id) ids.youtube.add(row.youtube_id);
    ids.slugs.add(row.slug);
  }
  for (const row of (skips.data ?? []) as { source: string; external_id: string }[]) {
    if (row.source === "instagram" || row.source === "youtube") ids.skipped![row.source].add(row.external_id);
  }
  return ids;
}

/** Imports new Instagram and YouTube posts as drafts. Uses the admin's session, so RLS applies. */
export async function importNow(): Promise<void> {
  const supabase = await adminClientOr("/admin");
  const at = new Date().toISOString();
  let result: LastImportInput;
  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    const igToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const ytKey = process.env.YOUTUBE_API_KEY;
    const ytChannel = process.env.YOUTUBE_CHANNEL_ID;
    if (!geminiKey) throw new Error("GEMINI_API_KEY is not set");
    if (!igToken && !(ytKey && ytChannel)) throw new Error("No Instagram or YouTube keys are set");

    const summary = await runImport({
      fetchInstagram: igToken
        ? () => fetchInstagramMedia({ accessToken: igToken, fetch, limit: INSTAGRAM_LIMIT })
        : async () => [],
      fetchYouTube:
        ytKey && ytChannel
          ? () => fetchYouTubeUploads({ apiKey: ytKey, channelId: ytChannel, fetch })
          : undefined,
      parseCaption: (caption) => parseCaption(caption, { apiKey: geminiKey, fetch }),
      existingIds: () => existingIds(supabase),
      saveDraft: async (row: DraftRow) => {
        const { error } = await supabase.from("recipes").insert(row);
        if (error) throw new Error(error.message);
      },
      recordSkip: async ({ source, id, reason }: SkipRecord) => {
        const { error } = await supabase
          .from("import_skips")
          .upsert({ source, external_id: id, reason }, { onConflict: "source,external_id", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      },
    });
    result = { at, ...summary };
  } catch (e) {
    result = {
      at,
      imported: 0,
      skipped: 0,
      noRecipe: [],
      failed: [],
      error: e instanceof Error ? e.message : "Import failed",
    };
  }

  writeLastImportCookie(await cookies(), result);
  revalidateRecipes();
}

function onSupabaseStorage(url: string): boolean {
  const config = supabaseConfig();
  if (!config) return false;
  try {
    return new URL(url).host === new URL(config.url).host;
  } catch {
    return false;
  }
}

/** Copies an outside cover into recipe-images with the admin's client; null if that fails. */
async function storedCover(supabase: SupabaseClient, url: string, slug: string): Promise<string | null> {
  return copyCoverToStorage({
    url,
    slug,
    fetch,
    upload: async ({ bucket, path, body, contentType }) => {
      const storage = supabase.storage.from(bucket);
      const { error } = await storage.upload(path, body, { contentType, upsert: true });
      if (error) throw new Error(error.message);
      return storage.getPublicUrl(path).data.publicUrl;
    },
  });
}

/**
 * useActionState action for DraftForm. Saves the edited fields; with intent "publish" it also
 * copies the cover into Storage and goes live (keeping published_at if it is already live).
 * Bad input returns {errors}; success redirects.
 */
export async function updateDraft(_prev: DraftFormState, formData: FormData): Promise<DraftFormState> {
  const rawId = formData.get("id");
  const supabase = await adminClientOr(`/admin/recipes/${typeof rawId === "string" ? rawId : ""}`);

  const parsed = parseDraftForm(formData);
  if (!parsed.success) return { errors: parsed.errors };
  const { id, intent, ...fields } = parsed.data;

  const { data: current, error: readError } = await supabase
    .from("recipes")
    .select("slug, status, published_at, cover_image_url")
    .eq("id", id)
    .maybeSingle<{ slug: string; status: string; published_at: string | null; cover_image_url: string | null }>();
  if (readError) return { errors: { form: `Could not load the recipe: ${readError.message}` } };
  if (!current) return { errors: { form: "This recipe no longer exists." } };

  const update: Record<string, unknown> = { ...fields };
  if (intent === "publish" && current.cover_image_url && !onSupabaseStorage(current.cover_image_url)) {
    // Social CDN links expire, so publish with a copy in Storage (or no cover rather than a broken one).
    update.cover_image_url = await storedCover(supabase, current.cover_image_url, current.slug);
  }

  const { error } = await supabase.from("recipes").update(update).eq("id", id);
  if (error) return { errors: { form: `Could not save: ${error.message}` } };

  if (intent === "publish" && current.status !== "live") {
    // Only a draft gets a new published_at; the status filter keeps a racing publish from moving it.
    const { error: publishError } = await supabase
      .from("recipes")
      .update({ status: "live", published_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft");
    if (publishError) return { errors: { form: `Could not publish: ${publishError.message}` } };
  }

  revalidateRecipes();
  redirect(intent === "publish" ? "/admin?published=1" : `/admin/recipes/${id}?saved=1`);
}
