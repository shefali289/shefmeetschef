import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import AskShef from "@/components/ask/AskShef";
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
import { recipeJsonLd, serializeJsonLd } from "@/lib/jsonld";
import { getViewer } from "@/lib/auth/session";
import { FREE_LIMITS } from "@/lib/limits";
import { getRecipeForViewer, listRecipes } from "@/lib/recipes";
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
          />
        </Reveal>
        <Reveal>
          <RecipeActions reelUrl={recipe.reel_url} youtubeUrl={recipe.youtube_url} />
        </Reveal>
      </div>
    </main>
  );
}
