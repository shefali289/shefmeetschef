import type { Metadata } from "next";
import { safeNext } from "@/lib/auth/safe-redirect";
import { supabaseConfig } from "@/lib/supabase/config";
import SignInForm from "./SignInForm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  const failed = typeof params.error === "string";
  const configured = supabaseConfig() !== null;

  return (
    <main className="mx-auto max-w-md px-4 py-10 text-shef-navy">
      <h1 className="text-3xl font-bold">Sign in</h1>
      {configured ? (
        <>
          <p className="mt-2">Save recipes, share your remixes and join challenges.</p>
          {failed && (
            <p role="alert" className="mt-4 rounded-lg border border-shef-orange bg-white p-3">
              That sign-in link did not work. Please try again.
            </p>
          )}
          <SignInForm next={next} />
        </>
      ) : (
        <p className="mt-4 rounded-lg border border-shef-navy/20 bg-white p-4">
          Sorry, sign-in is not set up yet. You can still browse every recipe.
        </p>
      )}
    </main>
  );
}
