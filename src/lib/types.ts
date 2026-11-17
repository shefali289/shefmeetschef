import { z } from "zod";

import { ALLERGENS, CATEGORIES, CUISINES, DIET_TAGS } from "./taxonomy";

// Re-exported so existing imports keep working; taxonomy.ts is zod-free for client bundles.
export { ALLERGENS, CATEGORIES, CUISINES, DIET_TAGS };

export type Cuisine = (typeof CUISINES)[number];
export type Category = (typeof CATEGORIES)[number];
export type DietTag = (typeof DIET_TAGS)[number];
export type Allergen = (typeof ALLERGENS)[number];

export type RecipeSource = "shef" | "outside";
export type RecipeStatus = "draft" | "live";

export const IngredientSchema = z.object({
  qty: z.number().positive().nullable(),
  unit: z.string().min(1).nullable(),
  item: z.string().min(1),
  note: z.string().nullable().optional(),
});

export const StepSchema = z.object({
  text: z.string().min(1),
});

export const RecipeSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  description: z.string().nullable(),
  reel_url: z.string().url().nullable(),
  youtube_url: z.string().url().nullable(),
  cover_image_url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "cover_image_url must be https")
    .nullable(),
  source: z.enum(["shef", "outside"]),
  ingredients: z.array(IngredientSchema),
  steps: z.array(StepSchema),
  base_servings: z.number().int().min(1).max(12),
  prep_minutes: z.number().int().nonnegative().nullable(),
  cook_minutes: z.number().int().nonnegative().nullable(),
  cuisine: z.enum(CUISINES).nullable(),
  diet_tags: z.array(z.enum(DIET_TAGS)),
  allergens: z.array(z.enum(ALLERGENS)),
  categories: z.array(z.enum(CATEGORIES)),
  status: z.enum(["draft", "live"]),
  published_at: z.string().nullable(),
});

export interface Ingredient {
  qty: number | null;
  unit: string | null;
  item: string;
  note?: string | null;
}

export interface Step {
  text: string;
}

export interface Recipe {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  reel_url: string | null;
  youtube_url: string | null;
  cover_image_url: string | null;
  source: RecipeSource;
  ingredients: Ingredient[];
  steps: Step[];
  base_servings: number;
  prep_minutes: number | null;
  cook_minutes: number | null;
  cuisine: string | null;
  diet_tags: string[];
  allergens: string[];
  categories: string[];
  status: RecipeStatus;
  published_at: string | null;
}
