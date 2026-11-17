import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";

/**
 * Supabase client for server components, route handlers and server actions. Uses the anon key
 * and the visitor's session cookies, so RLS applies. Null when Supabase is not set up.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const config = supabaseConfig();
  if (!config) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a server component, where cookies are read-only. The middleware
          // refreshes the session instead.
        }
      },
    },
  });
}
