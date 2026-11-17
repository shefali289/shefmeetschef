import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** True when the browser says the POST came from this site (blocks cross-site sign-out). */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    const host = new URL(origin).host;
    const allowed = [request.nextUrl.host, request.headers.get("x-forwarded-host"), request.headers.get("host")];
    return new URL(origin).origin === request.nextUrl.origin || allowed.includes(host);
  } catch {
    return false;
  }
}

/** POST only, so a link or image cannot sign people out; the Origin check stops cross-site forms. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.nextUrl.origin), 303);
}
