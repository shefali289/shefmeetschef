import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import RemixForm from "@/components/remix/RemixForm";
import { getViewer } from "@/lib/auth/session";
import { FREE_LIMITS } from "@/lib/limits";
import { getRecipeBySlug } from "@/lib/recipes";
import { REMIX_BANNED_TEXT } from "@/lib/remix/post-remix";
import { REMIX_NOT_CONFIGURED } from "@/lib/remix/status";
import { usageRemaining } from "@/lib/usage";
import { postRemixAction } from "./actions";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "Post a remix", robots: { index: false, follow: false } };
// Per-user page (session, ban check and usage counter): never prerendered or cached.
export const dynamic = "force-dynamic";

const backLink =
  "press inline-flex min-h-11 items-center rounded-full font-bold text-copper-ink underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper";

/** Post a photo of your take on one of Shef's recipes and say what you changed. */
export default async function RemixPage({ params }: Props) {
  const { slug } = await params;
  // Only live Shef recipes can be remixed, never outside reels.
  const recipe = await getRecipeBySlug(slug);
  if (!recipe) notFound();

  const viewer = await getViewer();
  const remixPath = `/recipes/${recipe.slug}/remix`;
  if (viewer.configured && !viewer.user) redirect(`/sign-in?next=${encodeURIComponent(remixPath)}`);

  let body: React.ReactNode;
  if (!viewer.supabase || !viewer.user) {
    body = <p className="font-semibold">{REMIX_NOT_CONFIGURED}</p>;
  } else if ((await viewer.supabase.rpc("is_banned")).data === true) {
    body = <p className="font-semibold">{REMIX_BANNED_TEXT}</p>;
  } else {
    // A hint only: the insert itself spends the remix and enforces the limit.
    const remaining = await usageRemaining(viewer.supabase, "remix", FREE_LIMITS.remix).catch(() => FREE_LIMITS.remix);
    body = (
      <RemixForm
        slug={recipe.slug}
        userId={viewer.user.id}
        remaining={remaining}
        limit={FREE_LIMITS.remix}
        action={postRemixAction}
      />
    );
  }

  return (
    <main id="main" className="mx-auto max-w-2xl px-4 pt-8 pb-16">
      <div className="animate-fade-up">
        <p className="font-hand text-2xl text-herb">made it your way?</p>
        <h1 className="mt-1 text-4xl font-extrabold text-cocoa">
          <span className="brush">Remix</span> <span className="font-script font-normal">{recipe.title}</span>
        </h1>
        <p className="mt-4 text-lg text-cocoa">
          Share a photo of your version and tell everyone what you changed. Shef&rsquo;s team has a quick
          look before it goes up on the recipe page.
        </p>
      </div>
      <div className="mt-8 rounded-[1.75rem] bg-white/80 p-5 shadow-soft ring-1 ring-cocoa/10 sm:p-6">{body}</div>
      <p className="mt-6">
        <Link href={`/recipes/${recipe.slug}`} className={backLink}>
          Back to {recipe.title}
        </Link>
      </p>
    </main>
  );
}
