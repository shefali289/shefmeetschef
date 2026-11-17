import Link from "next/link";
import AboutShef from "@/components/brand/AboutShef";
import Hero from "@/components/brand/Hero";
import HerbSprig from "@/components/brand/HerbSprig";
import RecipeGrid from "@/components/recipe/RecipeGrid";
import { listRecipes } from "@/lib/recipes";

export const revalidate = 3600;

const LATEST_COUNT = 9;

export default async function Home() {
  const latest = [...(await listRecipes())]
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
    .slice(0, LATEST_COUNT);

  return (
    <main id="main">
      <Hero />
      <section aria-labelledby="latest-heading" className="mx-auto max-w-5xl px-4 pb-12">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <h2 id="latest-heading" className="flex items-center gap-2 text-2xl font-bold text-shef-navy">
            <HerbSprig className="h-8 w-8" />
            Latest recipes
          </h2>
          <Link
            href="/recipes"
            className="inline-flex min-h-11 items-center font-semibold text-shef-orange underline underline-offset-4 hover:text-shef-orange-dark"
          >
            See all recipes
          </Link>
        </div>
        <RecipeGrid recipes={latest} emptyText="Shef is still cooking. Check back soon!" />
      </section>
      <AboutShef />
    </main>
  );
}
