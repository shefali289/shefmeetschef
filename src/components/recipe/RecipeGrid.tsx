import RecipeCard from "@/components/recipe/RecipeCard";
import type { Recipe } from "@/lib/types";

export default function RecipeGrid({
  recipes,
  emptyText = "No recipes match those filters yet.",
}: {
  recipes: Recipe[];
  emptyText?: string;
}) {
  if (recipes.length === 0) {
    return (
      <p className="rounded-2xl bg-white p-6 text-center text-lg text-shef-navy">
        {emptyText}
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {recipes.map((r) => (
        <li key={r.id}>
          <RecipeCard recipe={r} />
        </li>
      ))}
    </ul>
  );
}
