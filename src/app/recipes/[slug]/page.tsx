import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import AskShef from "@/components/ask/AskShef";
import CookbookAnnouncer from "@/components/cookbook/CookbookAnnouncer";
import SaveButton from "@/components/cookbook/SaveButton";
import AllergenBox from "@/components/recipe/AllergenBox";
import DietTags from "@/components/recipe/DietTags";
import MediaEmbeds from "@/components/recipe/MediaEmbeds";
import OutsideTag from "@/components/recipe/OutsideTag";
import RecipeActions from "@/components/recipe/RecipeActions";
import ServingsScaler from "@/components/recipe/ServingsScaler";
import RecipePlaceholder from "@/components/recipe/RecipePlaceholder";
import StepList from "@/components/recipe/StepList";
import Reveal from "@/components/motion/Reveal";
import RemixList from "@/components/remix/RemixList";
import RemixThisButton from "@/components/remix/RemixThisButton";
import { recipeJsonLd, serializeJsonLd } from "@/lib/jsonld";
import { getViewer } from "@/lib/auth/session";
import { FREE_LIMITS } from "@/lib/limits";
import { getRecipeForViewer, listRecipes } from "@/lib/recipes";
import { loadOwnRemixes, loadRemixFeed, markLiked } from "@/lib/remix/feed";
import type { OwnRemixCard, RemixCardData } from "@/lib/remix/types";
import { isDietTag } from "@/lib/taxonomy";
import { usageRemaining } from "@/lib/usage";
import { askShefAction } from "./actions";
import { shareImage } from "@/lib/share-image";
import { siteUrl } from "@/lib/site";

type Props = { params: Promise<{ slug: string }> };

// Without Supabase (sample recipes) pages are static and revalidated hourly. Once Supabase is set
// up, every page renders per request: it reads the visitor's session cookies, so nothing
// per-user (outside recipes, the Ask Shef counter) is ever cached and shared.
export const revalidate = 3600;

/** Newest approved remixes shown on the recipe page; the rest are on /remixes. */
const RECIPE_PAGE_REMIXES = 6;

/** Only public Shef recipes are pre-rendered; outside recipes never are. */
export async function generateStaticParams() {
  const recipes = await listRecipes();
  return recipes.map((r) => ({ slug: r.slug }));
}

/** The viewer and the recipe they may see, once per request (shared by metadata and the page). */
const loadPage = cache(async (slug: string) => {
  const viewer = await getViewer();
  const recipe = await getRecipeForViewer(slug, viewer.supabase, viewer.user?.id ?? null);
  return { viewer, recipe };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { recipe } = await loadPage((await params).slug);
  if (!recipe) return { title: "Recipe not found" };
  // A user's private outside recipe: never indexed or shared.
  if (recipe.source === "outside") {
    return { title: recipe.title, robots: { index: false, follow: false } };
  }
  const description = recipe.description ?? `${recipe.title}, a recipe by Shef.`;
  const image = shareImage(recipe, siteUrl());
  return {
    title: recipe.title,
    description,
    alternates: { canonical: `/recipes/${recipe.slug}` },
    openGraph: {
      type: "article",
      title: recipe.title,
      description,
      url: `/recipes/${recipe.slug}`,
      publishedTime: recipe.published_at ?? undefined,
      images: [{ url: image, alt: recipe.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: recipe.title,
      description,
      images: [image],
    },
  };
}

function minutes(label: string, value: number | null) {
  if (value === null) return null;
  return (
    <div className="rounded-2xl bg-white/80 px-4 py-2 shadow-soft ring-1 ring-cocoa/10">
      <dt className="font-hand text-lg leading-none text-cocoa-soft">{label}</dt>
      <dd className="font-extrabold text-cocoa">{value} min</dd>
    </div>
  );
}

export default async function RecipePage({ params }: Props) {
  const { viewer, recipe } = await loadPage((await params).slug);
  if (!recipe) notFound();
  const outside = recipe.source === "outside";

  const askConfigured = viewer.configured && Boolean(process.env.GEMINI_API_KEY);
  let askRemaining: number = FREE_LIMITS.ask;
  if (askConfigured && viewer.user && viewer.supabase) {
    // The counter is a hint only; consume_usage enforces the limit when they ask.
    askRemaining = await usageRemaining(viewer.supabase, "ask", FREE_LIMITS.ask).catch(() => FREE_LIMITS.ask);
  }

  // Whether the heart starts pressed: the viewer's own save, read through their session (RLS).
  let saved = false;
  if (viewer.user && viewer.supabase) {
    const { data } = await viewer.supabase
      .from("saves")
      .select("id")
      .eq("recipe_id", recipe.id)
      .eq("user_id", viewer.user.id)
      .maybeSingle();
    saved = Boolean(data);
  }

  // Remixes are for Shef recipes only. Approved ones for everyone; the viewer's own in any status.
  let remixes: RemixCardData[] = [];
  let ownRemixes: OwnRemixCard[] = [];
  if (!outside && viewer.supabase) {
    const supabase = viewer.supabase;
    const user = viewer.user;
    const [feed, own] = await Promise.all([
      loadRemixFeed(supabase, { recipeId: recipe.id, sort: "newest", limit: RECIPE_PAGE_REMIXES }),
      user ? loadOwnRemixes(supabase, user.id, recipe.id, recipe) : Promise.resolve([]),
    ]);
    // The owner's own remixes are shown once, in "Your remixes" with their status.
    const ownIds = new Set(own.map((r) => r.id));
    remixes = feed.cards.filter((c) => !ownIds.has(c.id));
    if (user) remixes = await markLiked(supabase, user.id, remixes);
    ownRemixes = own;
  }

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 pb-16">
      {!outside && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(recipeJsonLd(recipe, siteUrl())) }}
        />
      )}

      <header className="-mx-4 mb-8 overflow-hidden bg-gradient-to-br from-peach-light via-cream to-blush-light px-4 pt-4 pb-8 sm:mx-0 sm:mt-6 sm:rounded-[2rem] sm:px-8 sm:pt-8 sm:shadow-soft sm:ring-1 sm:ring-cocoa/10">
        <div className="animate-scale-in overflow-hidden rounded-[1.75rem] shadow-soft ring-4 ring-white">
          {recipe.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={recipe.cover_image_url} alt="" className="aspect-[4/3] w-full object-cover" />
          ) : (
            <RecipePlaceholder className="aspect-[16/9] w-full" />
          )}
        </div>
        <div className="animate-fade-up mt-6" style={{ "--delay": "150ms" } as React.CSSProperties}>
          {outside ? (
            <OutsideTag reelUrl={recipe.reel_url} />
          ) : (
            <p className="font-hand text-2xl text-herb">from Shef&rsquo;s kitchen</p>
          )}
          <h1 className="font-script text-5xl leading-tight break-words tracking-[0.015em] text-cocoa sm:text-6xl">
            {recipe.title}
          </h1>
          {recipe.description && <p className="mt-3 text-lg text-cocoa">{recipe.description}</p>}
          {(recipe.prep_minutes !== null || recipe.cook_minutes !== null) && (
            <dl className="mt-5 flex flex-wrap gap-3">
              {minutes("Prep", recipe.prep_minutes)}
              {minutes("Cook", recipe.cook_minutes)}
            </dl>
          )}
          {recipe.diet_tags.length > 0 && (
            <div className="mt-5">
              <DietTags tags={recipe.diet_tags} />
            </div>
          )}
          <div className="mt-5">
            <SaveButton recipeId={recipe.id} slug={recipe.slug} saved={saved} signedIn={viewer.user !== null} />
          </div>
        </div>
      </header>

      <div className="space-y-10">
        {(recipe.reel_url || recipe.youtube_url) && (
          <Reveal>
            <MediaEmbeds title={recipe.title} reelUrl={recipe.reel_url} youtubeUrl={recipe.youtube_url} />
          </Reveal>
        )}

        <Reveal as="section" aria-labelledby="ingredients-heading">
          <h2 id="ingredients-heading" className="mb-4 text-3xl font-extrabold">
            <span className="brush">Ingredients</span>
          </h2>
          <div className="rounded-[1.75rem] bg-white p-5 shadow-soft ring-1 ring-cocoa/10">
            <ServingsScaler baseServings={recipe.base_servings} ingredients={recipe.ingredients} />
          </div>
        </Reveal>

        <Reveal>
          <AllergenBox allergens={recipe.allergens} />
        </Reveal>
        <Reveal>
          <StepList steps={recipe.steps} />
        </Reveal>
        <Reveal>
          <AskShef
            slug={recipe.slug}
            configured={askConfigured}
            signedIn={viewer.user !== null}
            remaining={askRemaining}
            limit={FREE_LIMITS.ask}
            original={{ ingredients: recipe.ingredients, steps: recipe.steps, diet_tags: recipe.diet_tags.filter(isDietTag) }}
            action={askShefAction}
            remixable={!outside && viewer.configured}
          />
        </Reveal>
        {!outside && (
          <Reveal as="section" aria-labelledby="remixes-heading" className="space-y-5">
            <div>
              <p className="font-hand text-2xl text-herb">made it your way?</p>
              {/* A stable focus target after a remix card is deleted. */}
              <h2 id="remixes-heading" tabIndex={-1} className="text-3xl font-extrabold focus:outline-none">
                <span className="brush">Remixes</span>
              </h2>
              <p className="mt-2 text-cocoa">
                Share a photo of your take on Shef&rsquo;s {recipe.title} and what you changed.
              </p>
            </div>
            {/* The one persistent status region for the section (e.g. "Remix deleted"). */}
            <CookbookAnnouncer />
            <RemixThisButton slug={recipe.slug} signedIn={viewer.user !== null} configured={viewer.configured} />
            {viewer.configured ? (
              <>
                {ownRemixes.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xl font-extrabold">Your remixes</h3>
                    <RemixList
                      remixes={ownRemixes}
                      own
                      signedIn
                      returnTo={`/recipes/${recipe.slug}`}
                      label="Your remixes"
                      showRecipe={false}
                    />
                  </div>
                )}
                {remixes.length > 0 ? (
                  <RemixList
                    remixes={remixes}
                    signedIn={viewer.user !== null}
                    returnTo={`/recipes/${recipe.slug}`}
                    label={`Remixes of ${recipe.title}`}
                    showRecipe={false}
                  />
                ) : (
                  <p className="rounded-2xl bg-white p-4 ring-1 ring-cocoa/10">No remixes yet. Be the first!</p>
                )}
                <p>
                  <Link
                    href={`/remixes?recipe=${recipe.slug}`}
                    className="press inline-flex min-h-11 items-center rounded-full font-bold text-copper-ink underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper"
                  >
                    See all remixes of {recipe.title}
                  </Link>
                </p>
              </>
            ) : null}
          </Reveal>
        )}
        <Reveal>
          <RecipeActions reelUrl={recipe.reel_url} youtubeUrl={recipe.youtube_url} />
        </Reveal>
      </div>
    </main>
  );
}
