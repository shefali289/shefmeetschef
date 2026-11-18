// Return paths and revalidation shared by the remix server actions.
import "server-only";
import { revalidatePath } from "next/cache";
import { safeNext } from "@/lib/auth/safe-redirect";

export const REMIXES_PATH = "/remixes";

/** A same-site return path from the form, else /remixes. */
export function returnPath(formData: FormData): string {
  const value = formData.get("return_to");
  return typeof value === "string" && value ? safeNext(value) : REMIXES_PATH;
}

/** A recipe page: /recipes/<slug>, ignoring any query or hash. */
const RECIPE_PAGE = /^\/recipes\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:[?#]|$)/;

/** Refreshes /remixes, and the recipe page the action came from (never any other path). */
export function revalidateRemixes(returnTo: string) {
  revalidatePath(REMIXES_PATH);
  const recipe = RECIPE_PAGE.exec(returnTo);
  if (recipe) revalidatePath(`/recipes/${recipe[1]}`);
}
