import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

let browserClient: SupabaseClient | null = null;

/** Supabase client for client components (anon key only). Null when Supabase is not set up. */
export function createSupabaseBrowserClient(): SupabaseClient | null {
  const config = supabaseConfig();
  if (!config) return null;
  browserClient ??= createBrowserClient(config.url, config.anonKey);
  return browserClient;
}
