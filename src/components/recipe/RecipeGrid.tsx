import Image from "next/image";
import Reveal from "@/components/motion/Reveal";
import RecipeCard from "@/components/recipe/RecipeCard";
import type { Recipe } from "@/lib/types";

const STAGGER_MS = 90;

export default function RecipeGrid({
  recipes,
  emptyText = "No recipes match those filters yet.",
}: {
  recipes: Recipe[];
  emptyText?: string;
}) {
  if (recipes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-5 rounded-[1.75rem] bg-white/80 p-6 text-center shadow-soft ring-1 ring-cocoa/10 sm:flex-row sm:p-8 sm:text-left">
        <div className="w-36 shrink-0 overflow-hidden rounded-full bg-peach ring-4 ring-white sm:w-40">
          <Image
            src="/brand/shef-thinking.webp"
            alt="Shef thinking about what to cook next"
            width={1086}
            height={1448}
            sizes="10rem"
            className="aspect-square h-auto w-full object-cover object-top"
          />
        </div>
        <p className="text-lg text-cocoa">{emptyText}</p>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {recipes.map((r, i) => (
        <Reveal as="li" key={r.id} delay={(i % 3) * STAGGER_MS}>
          <RecipeCard recipe={r} />
        </Reveal>
      ))}
    </ul>
  );
}
