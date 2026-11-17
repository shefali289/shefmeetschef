import type { Metadata } from "next";
import RecipeGrid from "@/components/recipe/RecipeGrid";
import FilterChips from "@/components/search/FilterChips";
import SearchBar from "@/components/search/SearchBar";
import { filterRecipes, parseFilters } from "@/lib/filters";
import { listRecipes } from "@/lib/recipes";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const filters = parseFilters(await searchParams);
  return {
    title: filters.q ? `Recipes matching "${filters.q}"` : "Recipes",
    description: "Search Shef's Indian, fusion and everyday recipes by cuisine, category and diet.",
    // Filtered views are near duplicates of the full list.
    alternates: { canonical: "/recipes" },
  };
}

export default async function RecipesPage({ searchParams }: Props) {
  const filters = parseFilters(await searchParams);
  const recipes = filterRecipes(await listRecipes(), filters);

  return (
    <main id="main" className="mx-auto max-w-5xl px-4 pt-8 pb-16">
      <div className="animate-fade-up">
        <p className="font-hand text-2xl text-herb">what are we cooking today?</p>
        <h1 className="mt-1 text-4xl font-extrabold text-cocoa">
          <span className="brush">Recipes</span>
        </h1>
      </div>
      <div className="mt-6 flex flex-col gap-6">
        <SearchBar key={filters.q} filters={filters} />
        <div className="rounded-[1.75rem] bg-white/60 p-4 shadow-soft ring-1 ring-cocoa/10 sm:p-6">
          <FilterChips filters={filters} basePath="/recipes" />
        </div>
        <p aria-live="polite" className="font-semibold text-cocoa-soft">
          {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"}
        </p>
        <section aria-labelledby="results-heading">
          <h2 id="results-heading" className="sr-only">
            Results
          </h2>
          <RecipeGrid recipes={recipes} />
        </section>
      </div>
    </main>
  );
}
