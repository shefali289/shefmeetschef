import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import type { AuthUser } from "@/lib/auth/require-admin";

export const COOKBOOK_PATH = "/cookbook";
export const NOT_CONFIGURED = "The cookbook is not set up yet. Check back soon!";

/**
 * For cookbook server actions: the signed-in user's own client (RLS applies), or null when
 * Supabase is not set up. Signed-out users are redirected to sign in, then back to `returnTo`.
 */
export async function cookbookUser(
  returnTo: string = COOKBOOK_PATH,
): Promise<{ supabase: SupabaseClient; user: AuthUser } | null> {
  const viewer = await getViewer();
  if (!viewer.configured || !viewer.supabase) return null;
  if (!viewer.user) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  return { supabase: viewer.supabase, user: viewer.user };
}
