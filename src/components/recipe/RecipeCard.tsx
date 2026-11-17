import Link from "next/link";
import DietTags from "@/components/recipe/DietTags";
import type { Recipe } from "@/lib/types";

function totalMinutes(r: Recipe): number | null {
  if (r.prep_minutes === null && r.cook_minutes === null) return null;
  return (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0);
}

export default function RecipeCard({ recipe }: { recipe: Recipe }) {
  const minutes = totalMinutes(recipe);
  return (
    <article className="h-full">
      <Link
        href={`/recipes/${recipe.slug}`}
        className="flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-shef-orange/15 transition hover:shadow-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-shef-navy"
      >
        {recipe.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={recipe.cover_image_url}
            alt=""
            loading="lazy"
            className="aspect-[4/3] w-full object-cover"
          />
        ) : (
          // Decorative branded placeholder; the title below names the card.
          <div
            aria-hidden="true"
            className="flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br from-shef-orange via-spice to-herb"
          >
            <span className="text-5xl font-extrabold text-white/80">{recipe.title.charAt(0)}</span>
          </div>
        )}
        <div className="flex flex-1 flex-col gap-3 p-4">
          <h3 className="font-script text-2xl leading-snug text-shef-orange">{recipe.title}</h3>
          {minutes !== null && <p className="text-sm text-shef-navy">{minutes} min</p>}
          <DietTags tags={recipe.diet_tags} />
        </div>
      </Link>
    </article>
  );
}
