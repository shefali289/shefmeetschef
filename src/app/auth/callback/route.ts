import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** OAuth / magic-link landing: swaps the code for a session, then goes to a same-site path. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  const supabase = await createSupabaseServerClient();
  if (supabase && code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.nextUrl.origin), 303);
  }
  const failed = new URL("/sign-in", request.nextUrl.origin);
  failed.searchParams.set("error", "callback");
  failed.searchParams.set("next", next);
  return NextResponse.redirect(failed, 303);
}
