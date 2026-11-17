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
      <h1 className="text-3xl font-extrabold text-shef-navy">Recipes</h1>
      <div className="mt-6 flex flex-col gap-6">
        <SearchBar key={filters.q} filters={filters} />
        <FilterChips filters={filters} basePath="/recipes" />
        <p aria-live="polite" className="text-shef-navy">
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
