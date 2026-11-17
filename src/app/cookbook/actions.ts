"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeNext } from "@/lib/auth/safe-redirect";
import { savesLimitReachedText } from "@/lib/limits";
import { COOKBOOK_PATH, NOT_CONFIGURED, cookbookUser } from "./action-auth";
import { fields, firstIssue, uuidField as id } from "./validation";

export type CookbookActionState = { ok?: boolean; saved?: boolean; error?: string };

const FOLDER_NAME_MAX = 80;
const TRY_AGAIN = "Something went wrong. Please try again in a minute.";

const NO_FOLDER = "We couldn't find that folder. It may have been deleted.";
const NO_SAVE = "We couldn't find that save. It may have been removed.";
const folderName = z
  .string({ error: "Give your folder a name." })
  .trim()
  .min(1, { error: "Give your folder a name." })
  .max(FOLDER_NAME_MAX, { error: `Folder names can be up to ${FOLDER_NAME_MAX} characters.` });

const ToggleSave = z.object({ recipe_id: id, intent: z.enum(["save", "unsave"]) });
const CreateFolder = z.object({ name: folderName });
const RenameFolder = z.object({ folder_id: id, name: folderName });
const DeleteFolder = z.object({ folder_id: id });
const MoveSave = z.object({ save_id: id, folder_id: z.union([z.literal(""), id]) });
const RemoveSave = z.object({ save_id: id });

type DbError = { code?: string; message: string } | null;

function invalid(error: z.ZodError): CookbookActionState {
  return { error: firstIssue(error) };
}

/**
 * Result of a write that chained .select("id"): RLS hides rows that are not the user's, so zero
 * rows back means nothing was changed. Revalidates only on success.
 */
function touched(
  res: { data: unknown[] | null; error: DbError },
  notFound: string,
  failed: string = TRY_AGAIN,
): CookbookActionState {
  if (res.error) return { error: failed };
  if (!res.data || res.data.length === 0) return { error: notFound };
  return done({ ok: true });
}

function done(state: CookbookActionState): CookbookActionState {
  revalidatePath(COOKBOOK_PATH);
  return state;
}

function isLimitError(error: DbError): boolean {
  return Boolean(error && (error.code === "SMS01" || /saves_limit_reached/.test(error.message)));
}

/** Heart on a recipe page. Fields: recipe_id, intent ("save" | "unsave"), return_to (optional path). */
export async function toggleSave(_prev: CookbookActionState, formData: FormData): Promise<CookbookActionState> {
  const returnTo = formData.get("return_to");
  const auth = await cookbookUser(typeof returnTo === "string" && returnTo ? safeNext(returnTo) : COOKBOOK_PATH);
  if (!auth) return { error: NOT_CONFIGURED };
  const parsed = ToggleSave.safeParse(fields(formData, ["recipe_id", "intent"]));
  if (!parsed.success) return invalid(parsed.error);
  const { supabase, user } = auth;
  const { recipe_id, intent } = parsed.data;

  if (intent === "unsave") {
    const { error } = await supabase.from("saves").delete().eq("recipe_id", recipe_id).eq("user_id", user.id);
    if (error) return { saved: true, error: TRY_AGAIN };
    return done({ ok: true, saved: false });
  }

  // New saves start unfiled; the user and folder are never taken from the client.
  const { error } = await supabase.from("saves").insert({ user_id: user.id, recipe_id, folder_id: null });
  if (isLimitError(error)) return { saved: false, error: savesLimitReachedText() };
  // Already saved (unique user_id, recipe_id): that is what they wanted.
  if (error && error.code !== "23505") return { saved: false, error: TRY_AGAIN };
  return done({ ok: true, saved: true });
}

/** Field: name. */
export async function createFolder(_prev: CookbookActionState, formData: FormData): Promise<CookbookActionState> {
  const auth = await cookbookUser();
  if (!auth) return { error: NOT_CONFIGURED };
  const parsed = CreateFolder.safeParse(fields(formData, ["name"]));
  if (!parsed.success) return invalid(parsed.error);
  const { error } = await auth.supabase.from("folders").insert({ user_id: auth.user.id, name: parsed.data.name });
  if (error) return { error: TRY_AGAIN };
  return done({ ok: true });
}

/** Fields: folder_id, name. RLS (folders_own) makes sure it is the user's folder. */
export async function renameFolder(_prev: CookbookActionState, formData: FormData): Promise<CookbookActionState> {
  const auth = await cookbookUser();
  if (!auth) return { error: NOT_CONFIGURED };
  const parsed = RenameFolder.safeParse(fields(formData, ["folder_id", "name"]));
  if (!parsed.success) return invalid(parsed.error);
  const res = await auth.supabase
    .from("folders")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.folder_id)
    .select("id");
  return touched(res, NO_FOLDER);
}

/** Field: folder_id. Its saves are kept, unfiled (saves.folder_id is "on delete set null"). */
export async function deleteFolder(_prev: CookbookActionState, formData: FormData): Promise<CookbookActionState> {
  const auth = await cookbookUser();
  if (!auth) return { error: NOT_CONFIGURED };
  const parsed = DeleteFolder.safeParse(fields(formData, ["folder_id"]));
  if (!parsed.success) return invalid(parsed.error);
  const res = await auth.supabase.from("folders").delete().eq("id", parsed.data.folder_id).select("id");
  return touched(res, NO_FOLDER);
}

/** Fields: save_id, folder_id ("" means unfiled). RLS only allows the user's own save and folder. */
export async function moveSave(_prev: CookbookActionState, formData: FormData): Promise<CookbookActionState> {
  const auth = await cookbookUser();
  if (!auth) return { error: NOT_CONFIGURED };
  const parsed = MoveSave.safeParse(fields(formData, ["save_id", "folder_id"]));
  if (!parsed.success) return invalid(parsed.error);
  const res = await auth.supabase
    .from("saves")
    .update({ folder_id: parsed.data.folder_id || null })
    .eq("id", parsed.data.save_id)
    .select("id");
  return touched(res, NO_SAVE, "We couldn't move that recipe. Please try again.");
}

/** Field: save_id. Removes one of the user's saves, e.g. one whose recipe is no longer available. */
export async function removeSave(_prev: CookbookActionState, formData: FormData): Promise<CookbookActionState> {
  const auth = await cookbookUser();
  if (!auth) return { error: NOT_CONFIGURED };
  const parsed = RemoveSave.safeParse(fields(formData, ["save_id"]));
  if (!parsed.success) return invalid(parsed.error);
  const res = await auth.supabase
    .from("saves")
    .delete()
    .eq("id", parsed.data.save_id)
    .eq("user_id", auth.user.id)
    .select("id");
  return touched(res, NO_SAVE, "We couldn't remove that save. Please try again.");
}
