"use client";
import { useId, useState } from "react";
import DietTags from "@/components/recipe/DietTags";
import IngredientList from "@/components/recipe/IngredientList";
import type { ShefVersion } from "@/lib/ask-shef/types";

export interface ShefVersionToggleProps {
  original: ShefVersion;
  version: ShefVersion;
}

/**
 * Swaps the recipe card between the original and Shef's modified version from an answer.
 * Not saved in task 2 (task 3 saves a remix from `version`).
 */
export default function ShefVersionToggle({ original, version }: ShefVersionToggleProps) {
  const [showShef, setShowShef] = useState(false);
  const id = useId();
  const shown = showShef ? version : original;

  return (
    <div className="mt-4 rounded-[1.5rem] bg-cream p-4 ring-1 ring-cocoa/10">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-pressed={showShef}
          aria-controls={id}
          onClick={() => setShowShef((v) => !v)}
          className="press inline-flex min-h-11 items-center justify-center rounded-full border-2 border-copper px-5 py-2 font-bold text-cocoa hover:bg-blush-light focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper aria-pressed:bg-copper aria-pressed:text-white"
        >
          Shef&rsquo;s version
        </button>
        <p className="font-hand text-xl text-cocoa-soft" aria-live="polite">
          {showShef ? "showing Shef's version" : "showing the original"}
        </p>
      </div>
      <div id={id} className="mt-4 space-y-4">
        {shown.diet_tags.length > 0 && <DietTags tags={shown.diet_tags} />}
        <IngredientList ingredients={shown.ingredients} />
        <ol className="list-decimal space-y-2 pl-6 leading-relaxed">
          {shown.steps.map((step, i) => (
            <li key={i}>{step.text}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
