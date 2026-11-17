import { formatQuantity } from "@/lib/scaling";
import type { Ingredient } from "@/lib/types";

export default function IngredientList({ ingredients }: { ingredients: Ingredient[] }) {
  return (
    <ul className="divide-y divide-dashed divide-cocoa/15">
      {ingredients.map((ing, i) => (
        <li key={`${ing.item}-${i}`} className="flex gap-3 py-2.5">
          <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-herb" />
          <span>
            {ing.qty !== null && <span className="font-semibold">{formatQuantity(ing.qty, ing.unit)} </span>}
            {ing.unit && <span className="font-semibold">{ing.unit} </span>}
            <span>{ing.item}</span>
            {ing.note && <span className="text-cocoa-soft">, {ing.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
