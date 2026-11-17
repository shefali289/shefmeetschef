"use client";

import { useId, useState } from "react";
import { MAX_SERVINGS, MIN_SERVINGS, clampServings, scaleIngredients } from "@/lib/scaling";
import type { Ingredient } from "@/lib/types";
import IngredientList from "./IngredientList";

export interface ServingsScalerProps {
  baseServings: number;
  ingredients: Ingredient[];
}

export default function ServingsScaler({ baseServings, ingredients }: ServingsScalerProps) {
  const base = clampServings(baseServings);
  const [servings, setServings] = useState(base);
  const id = useId();
  const valueText = `${servings} ${servings === 1 ? "serving" : "servings"}`;

  return (
    <div>
      <div className="rounded-2xl bg-cream p-4 ring-1 ring-cocoa/10">
        <div className="flex items-baseline justify-between">
          <label htmlFor={id} className="font-semibold">
            Servings
          </label>
          <output htmlFor={id} aria-hidden="true" className="font-hand text-3xl leading-none font-bold text-copper-dark">
            {servings}
          </output>
        </div>
        <input
          id={id}
          type="range"
          min={MIN_SERVINGS}
          max={MAX_SERVINGS}
          step={1}
          value={servings}
          aria-valuetext={valueText}
          onChange={(e) => setServings(clampServings(Number(e.target.value)))}
          className="mt-1 h-11 w-full cursor-pointer accent-shef-orange"
        />
      </div>
      <div className="mt-4" aria-live="polite">
        <IngredientList ingredients={scaleIngredients(ingredients, base, servings)} />
      </div>
    </div>
  );
}
