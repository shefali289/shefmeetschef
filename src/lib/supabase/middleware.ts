import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "./config";

/** Request header carrying the path, so server layouts (e.g. /admin) can send people back to it. */
export const PATHNAME_HEADER = "x-pathname";

/**
 * Refreshes the Supabase session cookie on each request (skipped when Supabase is not set up)
 * and forwards the pathname to server components.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // Overwrite any client-sent value so it cannot be spoofed.
  request.headers.set(PATHNAME_HEADER, request.nextUrl.pathname);
  let response = NextResponse.next({ request });
  const config = supabaseConfig();
  if (!config) return response;

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });
  // Touching getUser() refreshes an expired access token.
  await supabase.auth.getUser();
  return response;
}
