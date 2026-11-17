import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  NotAdminError,
  NotSignedInError,
  requireAdmin,
  type AuthProfile,
  type AuthUser,
  type UserAndProfile,
} from "./require-admin";

/** The signed-in user (verified with Supabase Auth) and their own profile row, read through RLS. */
export async function getUserAndProfile(supabase: SupabaseClient): Promise<UserAndProfile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, is_admin")
    .eq("id", user.id)
    .maybeSingle<AuthProfile>();
  return { user: { id: user.id, email: user.email ?? null }, profile: profile ?? null };
}

export type AdminGate =
  | { state: "not-configured" }
  | { state: "signed-out" }
  | { state: "not-admin"; user: AuthUser }
  | { state: "admin"; user: AuthUser; supabase: SupabaseClient };

/** Server-side admin check for pages, once per request. Never throws for the expected states. */
export const adminGate = cache(async (): Promise<AdminGate> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { state: "not-configured" };
  const found = await getUserAndProfile(supabase);
  try {
    const { user } = await requireAdmin(async () => found);
    return { state: "admin", user, supabase };
  } catch (e) {
    if (e instanceof NotSignedInError || !found) return { state: "signed-out" };
    if (e instanceof NotAdminError) return { state: "not-admin", user: found.user };
    throw e;
  }
});

/** For server actions: the admin's own Supabase client, or throws. */
export async function requireAdminClient(): Promise<{ user: AuthUser; supabase: SupabaseClient }> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new NotSignedInError("Sign-in is not set up yet");
  const { user } = await requireAdmin(() => getUserAndProfile(supabase));
  return { user, supabase };
}

/** Header auth state: whether Supabase is set up and who is signed in. */
export async function getCurrentUser(): Promise<{ configured: boolean; user: AuthUser | null }> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { configured: false, user: null };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { configured: true, user: user ? { id: user.id, email: user.email ?? null } : null };
}
