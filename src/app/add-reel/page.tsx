import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { FREE_LIMITS } from "@/lib/limits";
import { usageRemaining } from "@/lib/usage";
import { addReelAction } from "./actions";
import AddReelForm from "./AddReelForm";

export const metadata: Metadata = { title: "Add a reel", robots: { index: false, follow: false } };
// Per-user page (session and usage counter): never prerendered or cached.
export const dynamic = "force-dynamic";

/** Paste an outside Instagram reel and its caption to get a private recipe card. */
export default async function AddReelPage() {
  const viewer = await getViewer();
  const configured = viewer.configured && Boolean(process.env.GEMINI_API_KEY);
  if (configured && !viewer.user) redirect(`/sign-in?next=${encodeURIComponent("/add-reel")}`);

  let remaining: number = FREE_LIMITS.outside_reel;
  if (configured && viewer.supabase) {
    // A hint only: the server checks again before spending a reel.
    remaining = await usageRemaining(viewer.supabase, "outside_reel", FREE_LIMITS.outside_reel).catch(
      () => FREE_LIMITS.outside_reel,
    );
  }

  return (
    <main id="main" className="mx-auto max-w-2xl px-4 pt-8 pb-16">
      <div className="animate-fade-up">
        <p className="font-hand text-2xl text-herb">saw something tasty on Instagram?</p>
        <h1 className="mt-1 text-4xl font-extrabold text-cocoa">
          <span className="brush">Add a reel</span>
        </h1>
        <p className="mt-4 text-lg text-cocoa">
          Paste the link to someone&rsquo;s reel and its caption, and Shef will turn it into a recipe
          card in your cookbook. Only you can see it.
        </p>
      </div>
      <div className="mt-8 rounded-[1.75rem] bg-white/80 p-5 shadow-soft ring-1 ring-cocoa/10 sm:p-6">
        {configured ? (
          <AddReelForm remaining={remaining} limit={FREE_LIMITS.outside_reel} action={addReelAction} />
        ) : (
          <div className="space-y-3">
            <p className="font-semibold">Sorry, adding reels is not set up yet. Check back soon!</p>
            <p>
              <Link
                href="/recipes"
                className="press inline-flex min-h-11 items-center rounded-full font-bold text-copper-ink underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper"
              >
                Browse Shef&rsquo;s recipes
              </Link>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
