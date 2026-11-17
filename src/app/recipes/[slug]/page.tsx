import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AllergenBox from "@/components/recipe/AllergenBox";
import DietTags from "@/components/recipe/DietTags";
import MediaEmbeds from "@/components/recipe/MediaEmbeds";
import RecipeActions from "@/components/recipe/RecipeActions";
import ServingsScaler from "@/components/recipe/ServingsScaler";
import StepList from "@/components/recipe/StepList";
import { recipeJsonLd, serializeJsonLd } from "@/lib/jsonld";
import { getRecipeBySlug, listRecipes } from "@/lib/recipes";
import { shareImage } from "@/lib/share-image";
import { siteUrl } from "@/lib/site";

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 3600;

export async function generateStaticParams() {
  const recipes = await listRecipes();
  return recipes.map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const recipe = await getRecipeBySlug((await params).slug);
  if (!recipe) return { title: "Recipe not found" };
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
    <div>
      <dt className="text-sm">{label}</dt>
      <dd className="font-bold">{value} min</dd>
    </div>
  );
}

export default async function RecipePage({ params }: Props) {
  const recipe = await getRecipeBySlug((await params).slug);
  if (!recipe) notFound();

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 pb-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(recipeJsonLd(recipe, siteUrl())) }}
      />

      <header className="-mx-4 mb-6 bg-gradient-to-br from-shef-orange to-spice px-4 py-10 text-white sm:mx-0 sm:mt-6 sm:rounded-2xl sm:px-8">
        {recipe.cover_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={recipe.cover_image_url}
            alt=""
            className="mb-6 aspect-[4/3] w-full rounded-xl object-cover"
          />
        )}
        <h1 className="font-script text-4xl leading-tight sm:text-5xl">{recipe.title}</h1>
        {recipe.description && <p className="mt-4 text-lg">{recipe.description}</p>}
        {(recipe.prep_minutes !== null || recipe.cook_minutes !== null) && (
          <dl className="mt-6 flex gap-6">
            {minutes("Prep", recipe.prep_minutes)}
            {minutes("Cook", recipe.cook_minutes)}
          </dl>
        )}
      </header>

      <div className="space-y-8">
        <DietTags tags={recipe.diet_tags} />
        <MediaEmbeds title={recipe.title} reelUrl={recipe.reel_url} youtubeUrl={recipe.youtube_url} />

        <section aria-labelledby="ingredients-heading">
          <h2 id="ingredients-heading" className="mb-4 text-2xl font-bold">
            Ingredients
          </h2>
          <ServingsScaler baseServings={recipe.base_servings} ingredients={recipe.ingredients} />
        </section>

        <AllergenBox allergens={recipe.allergens} />
        <StepList steps={recipe.steps} />
        <RecipeActions reelUrl={recipe.reel_url} youtubeUrl={recipe.youtube_url} />
      </div>
    </main>
  );
}
