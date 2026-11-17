import { z } from "zod";
import { DRAFT_LIMITS as L } from "@/lib/draft-limits";
import { ALLERGENS, CATEGORIES, CUISINES, DIET_TAGS } from "@/lib/types";

/** What DraftForm's useActionState holds: field errors keyed by field name. */
export type DraftFormState = { errors?: Record<string, string> };

const blankToNull = (v: unknown) => (v === "" || v == null ? null : v);
const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters`);
const optionalText = (max: number) => text(max).transform((v) => v || null);
const minutes = z.preprocess(
  blankToNull,
  z.coerce.number().int("Whole minutes only").min(0).max(L.minutes).nullable(),
);

/**
 * Editable fields only. Slug, status, source, owner, ids and published_at are never taken from
 * the form.
 */
export const DraftFormSchema = z.object({
  id: z.uuid("Unknown recipe"),
  intent: z.enum(["save", "publish"]),
  title: text(L.title).min(1, "Title is required"),
  description: optionalText(L.description),
  base_servings: z.coerce.number().int().min(1, "Servings must be 1 to 12").max(12, "Servings must be 1 to 12"),
  prep_minutes: minutes,
  cook_minutes: minutes,
  cuisine: z
    .union([z.literal(""), z.enum(CUISINES)], { error: "Pick a cuisine from the list" })
    .transform((v) => v || null),
  diet_tags: z.array(z.enum(DIET_TAGS)).max(DIET_TAGS.length),
  allergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length),
  categories: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length),
  ingredients: z
    .array(
      z.object({
        qty: z.preprocess(
          blankToNull,
          z.coerce
            .number({ error: "Quantity must be a number" })
            .positive("Quantity must be more than 0")
            .max(100000)
            .nullable(),
        ),
        unit: optionalText(L.unit),
        item: text(L.item).min(1, "Every ingredient needs an item"),
        note: optionalText(L.note),
      }),
    )
    .min(1, "Add at least one ingredient")
    .max(L.ingredients, `At most ${L.ingredients} ingredients`),
  steps: z
    .array(z.object({ text: text(L.step).min(1, "Steps cannot be empty") }))
    .min(1, "Add at least one step")
    .max(L.steps, `At most ${L.steps} steps`),
});

export type DraftFormData = z.infer<typeof DraftFormSchema>;

/** Reads DraftForm's fields (ingredient rows are parallel lists) and validates them. */
export function parseDraftForm(
  formData: FormData,
): { success: true; data: DraftFormData } | { success: false; errors: Record<string, string> } {
  const all = (name: string) => formData.getAll(name).map((v) => (typeof v === "string" ? v : ""));
  const one = (name: string) => {
    const v = formData.get(name);
    return typeof v === "string" ? v : "";
  };
  const qtys = all("ingredient_qty");
  const units = all("ingredient_unit");
  const notes = all("ingredient_note");
  const parsed = DraftFormSchema.safeParse({
    id: one("id"),
    intent: one("intent") || "save",
    title: one("title"),
    description: one("description"),
    base_servings: one("base_servings"),
    prep_minutes: one("prep_minutes"),
    cook_minutes: one("cook_minutes"),
    cuisine: one("cuisine"),
    diet_tags: all("diet_tags"),
    allergens: all("allergens"),
    categories: all("categories"),
    ingredients: all("ingredient_item").map((item, i) => ({
      item,
      qty: qtys[i] ?? "",
      unit: units[i] ?? "",
      note: notes[i] ?? "",
    })),
    steps: all("step").map((t) => ({ text: t })),
  });
  if (parsed.success) return { success: true, data: parsed.data };

  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return { success: false, errors };
}
