import type { Ingredient } from "./types";

export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 12;

/** Kitchen-friendly fractions: eighths plus thirds. */
const FRACTIONS: [number, string][] = [
  [0, ""],
  [1 / 8, "1/8"],
  [1 / 4, "1/4"],
  [1 / 3, "1/3"],
  [3 / 8, "3/8"],
  [1 / 2, "1/2"],
  [5 / 8, "5/8"],
  [2 / 3, "2/3"],
  [3 / 4, "3/4"],
  [7 / 8, "7/8"],
  [1, ""],
];

export function scaleQuantity(qty: number | null, from: number, to: number): number | null {
  if (qty === null) return null;
  return (qty * to) / from;
}

const WHOLE_UNITS = new Set(["g", "ml"]);
const DECIMAL_UNITS = new Set(["kg", "l"]);

/** Metric amounts as decimals (g/ml whole, kg/l one decimal); kitchen units as fractions. */
export function formatQuantity(n: number, unit?: string | null): string {
  const u = unit?.toLowerCase();
  if (u && WHOLE_UNITS.has(u)) return String(n > 0 ? Math.max(1, Math.round(n)) : 0);
  if (u && DECIMAL_UNITS.has(u)) {
    const rounded = Math.round(n * 10) / 10;
    return String(n > 0 ? Math.max(0.1, rounded) : 0);
  }
  let whole = Math.floor(n);
  const rest = n - whole;
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) {
    if (Math.abs(rest - f[0]) < Math.abs(rest - best[0])) best = f;
  }
  if (best[0] === 1) whole += 1;
  // never show a positive amount as "0"
  if (whole === 0 && best[1] === "") return n > 0 ? "1/8" : "0";
  if (!best[1]) return String(whole);
  return whole === 0 ? best[1] : `${whole} ${best[1]}`;
}

export function scaleIngredients(list: Ingredient[], from: number, to: number): Ingredient[] {
  return list.map((ing) => ({ ...ing, qty: scaleQuantity(ing.qty, from, to) }));
}

export function clampServings(n: number): number {
  if (!Number.isFinite(n)) return MIN_SERVINGS;
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(n)));
}

/** "2 cup milk, full cream" style line for an ingredient. */
export function ingredientText(ing: Ingredient): string {
  const main = [ing.qty === null ? null : formatQuantity(ing.qty, ing.unit), ing.unit, ing.item]
    .filter(Boolean)
    .join(" ");
  return ing.note ? `${main}, ${ing.note}` : main;
}
