import type { Metadata } from "next";
import Link from "next/link";
import RemixList from "@/components/remix/RemixList";
import { getViewer } from "@/lib/auth/session";
import { getRecipeBySlug } from "@/lib/recipes";
import { asUuid, loadRemixFeed, markLiked } from "@/lib/remix/feed";
import { REMIX_NOT_CONFIGURED } from "@/lib/remix/status";

type Props = {
  searchParams: Promise<{ recipe?: string | string[]; challenge?: string | string[]; page?: string | string[] }>;
};

export const metadata: Metadata = {
  title: "Remixes",
  description: "Home cooks' takes on Shef's recipes: photos, swaps and twists.",
  alternates: { canonical: "/remixes" },
};

const pill =
  "press inline-flex min-h-11 items-center justify-center rounded-full border-2 border-copper bg-white px-5 py-2 font-bold text-cocoa hover:bg-blush-light focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Every approved remix, newest first, optionally for one recipe or challenge. */
export default async function RemixesPage({ searchParams }: Props) {
  const params = await searchParams;
  const viewer = await getViewer();

  let content: React.ReactNode;
  let recipeTitle: string | null = null;
  if (!viewer.supabase) {
    content = <p className="rounded-2xl bg-white p-5 font-semibold ring-1 ring-cocoa/10">{REMIX_NOT_CONFIGURED}</p>;
  } else {
    // Unknown or invalid filters are ignored rather than showing an error.
    const slug = one(params.recipe);
    const recipe = slug ? await getRecipeBySlug(slug) : null;
    recipeTitle = recipe?.title ?? null;
    const challengeId = asUuid(one(params.challenge));
    const feed = await loadRemixFeed(viewer.supabase, { recipeId: recipe?.id, challengeId, page: one(params.page) });
    const cards = viewer.user ? await markLiked(viewer.supabase, viewer.user.id, feed.cards) : feed.cards;

    const query = (page: number) => {
      const q = new URLSearchParams();
      if (recipe) q.set("recipe", recipe.slug);
      if (challengeId) q.set("challenge", challengeId);
      if (page > 1) q.set("page", String(page));
      const s = q.toString();
      return s ? `/remixes?${s}` : "/remixes";
    };
    const here = query(feed.page);

    content =
      cards.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 font-semibold ring-1 ring-cocoa/10">
          No remixes yet. Cook one of Shef&rsquo;s recipes your way and be the first!
        </p>
      ) : (
        <>
          <RemixList remixes={cards} signedIn={viewer.user !== null} returnTo={here} label="Remixes" />
          {(feed.page > 1 || feed.hasMore) && (
            <nav aria-label="More remixes" className="mt-8 flex flex-wrap justify-center gap-3">
              {feed.page > 1 && (
                <Link href={query(feed.page - 1)} className={pill}>
                  Newer remixes
                </Link>
              )}
              {feed.hasMore && (
                <Link href={query(feed.page + 1)} className={pill}>
                  Older remixes
                </Link>
              )}
            </nav>
          )}
        </>
      );
  }

  return (
    <main id="main" className="mx-auto max-w-5xl px-4 pt-8 pb-16">
      <div className="animate-fade-up">
        <p className="font-hand text-2xl text-herb">made in your kitchens</p>
        <h1 className="mt-1 text-4xl font-extrabold text-cocoa">
          <span className="brush">Remixes</span>
        </h1>
        <p className="mt-4 text-lg text-cocoa">
          {recipeTitle ? (
            <>
              Your takes on <span className="font-script text-2xl">{recipeTitle}</span>.{" "}
              <Link
                href="/remixes"
                className="font-bold text-copper-ink underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper"
              >
                See all remixes
              </Link>
            </>
          ) : (
            <>Your takes on Shef&rsquo;s recipes: swaps, shortcuts and a little extra chilli.</>
          )}
        </p>
      </div>
      <div className="mt-8">{content}</div>
    </main>
  );
}
