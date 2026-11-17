import Link from "next/link";
import AboutShef from "@/components/brand/AboutShef";
import FollowAlong from "@/components/brand/FollowAlong";
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
      <section aria-labelledby="latest-heading" className="mx-auto max-w-5xl px-4 pb-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div>
            <p className="font-hand text-2xl text-herb">fresh from the stove</p>
            <h2 id="latest-heading" className="flex items-center gap-2 text-3xl font-extrabold text-cocoa">
              <span className="brush">Latest recipes</span>
              <HerbSprig className="h-9 w-9" />
            </h2>
          </div>
          <Link
            href="/recipes"
            className="link-underline inline-flex min-h-11 items-center gap-1 font-bold text-copper-ink hover:text-copper-dark"
          >
            See all recipes <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
        <RecipeGrid recipes={latest} emptyText="Shef is still cooking. Check back soon!" />
      </section>
      <AboutShef />
      <FollowAlong />
    </main>
  );
}
