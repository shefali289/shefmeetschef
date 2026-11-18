import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

/** A cookie-free anon client for public reads (keeps pages static), or null when Supabase is not set up. */
export function createPublicSupabaseClient(): SupabaseClient | null {
  const config = supabaseConfig();
  if (!config) return null;
  return createClient(config.url, config.anonKey, { auth: { persistSession: false } });
}
