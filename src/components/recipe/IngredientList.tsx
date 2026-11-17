import { formatQuantity } from "@/lib/scaling";
import type { Ingredient } from "@/lib/types";

export default function IngredientList({ ingredients }: { ingredients: Ingredient[] }) {
  return (
    <ul className="divide-y divide-shef-navy/10">
      {ingredients.map((ing, i) => (
        <li key={`${ing.item}-${i}`} className="py-2">
          {ing.qty !== null && <span className="font-semibold">{formatQuantity(ing.qty, ing.unit)} </span>}
          {ing.unit && <span className="font-semibold">{ing.unit} </span>}
          <span>{ing.item}</span>
          {ing.note && <span className="text-shef-navy/80">, {ing.note}</span>}
        </li>
      ))}
    </ul>
  );
}
