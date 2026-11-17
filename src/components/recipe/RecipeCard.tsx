import Link from "next/link";
import DietTags from "@/components/recipe/DietTags";
import RecipePlaceholder from "@/components/recipe/RecipePlaceholder";
import type { Recipe } from "@/lib/types";

function totalMinutes(r: Recipe): number | null {
  if (r.prep_minutes === null && r.cook_minutes === null) return null;
  return (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0);
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="h-4 w-4 shrink-0 text-herb">
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 6v4.5l3 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function RecipeCard({ recipe }: { recipe: Recipe }) {
  const minutes = totalMinutes(recipe);
  return (
    <article className="h-full">
      <Link
        href={`/recipes/${recipe.slug}`}
        className="lift group flex h-full flex-col overflow-hidden rounded-[1.75rem] bg-white shadow-soft ring-1 ring-cocoa/10 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper"
      >
        <div className="overflow-hidden">
          {recipe.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={recipe.cover_image_url}
              alt=""
              loading="lazy"
              className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            // Decorative branded illustration; the title below names the card.
            <RecipePlaceholder className="aspect-[4/3] w-full transition-transform duration-500 group-hover:scale-105" />
          )}
        </div>
        <div className="flex flex-1 flex-col gap-3 px-5 pt-4 pb-5">
          <h3 className="font-script text-[2.1rem] leading-tight break-words tracking-[0.015em] text-cocoa">
            {recipe.title}
          </h3>
          {minutes !== null && (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-cocoa-soft">
              <ClockIcon />
              {minutes} min
            </p>
          )}
          <div className="mt-auto">
            <DietTags tags={recipe.diet_tags} />
          </div>
        </div>
      </Link>
    </article>
  );
}
