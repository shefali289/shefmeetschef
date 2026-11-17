"use client";

import { useActionState, useState } from "react";
import { DRAFT_LIMITS as L } from "@/lib/draft-limits";
import { ALLERGENS, CATEGORIES, CUISINES, DIET_TAGS, type Ingredient, type Recipe } from "@/lib/types";

/** Field errors returned by the server action, keyed by field name ("form" for general ones). */
export type DraftFormState = { errors?: Record<string, string> };

export interface DraftFormProps {
  recipe: Recipe;
  action: (prevState: DraftFormState, formData: FormData) => Promise<DraftFormState>;
}

const FIELD_LABELS: Record<string, string> = {
  form: "",
  id: "Recipe",
  title: "Title",
  description: "Description",
  base_servings: "Servings",
  prep_minutes: "Prep minutes",
  cook_minutes: "Cook minutes",
  cuisine: "Cuisine",
  ingredients: "Ingredients",
  steps: "Steps",
  diet_tags: "Diet tags",
  allergens: "Allergens",
  categories: "Categories",
};

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-sm font-semibold text-shef-orange-dark">
      {message}
    </p>
  );
}

type Row<T> = T & { key: number };

let nextKey = 0;
const withKey = <T,>(value: T): Row<T> => ({ ...value, key: nextKey++ });

const field =
  "mt-1 block w-full min-h-11 rounded-lg border border-shef-navy/30 bg-white px-3 py-2 text-shef-navy focus-visible:outline-2 focus-visible:outline-shef-orange";
const label = "block text-sm font-semibold text-shef-navy";
const smallButton =
  "inline-flex min-h-11 items-center rounded-full border border-shef-navy/30 px-4 text-sm font-semibold text-shef-navy hover:bg-shef-navy/5 focus-visible:outline-2 focus-visible:outline-shef-orange";

function TagGroup({
  legend,
  name,
  options,
  selected,
}: {
  legend: string;
  name: string;
  options: readonly string[];
  selected: string[];
}) {
  return (
    <fieldset className="mt-6">
      <legend className={label}>{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-shef-navy/20 bg-white px-3 text-sm"
          >
            <input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} className="size-4 accent-herb" />
            {o}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Edit an imported draft before publishing. Ingredients and steps can be added or removed. */
export default function DraftForm({ recipe, action }: DraftFormProps) {
  const [ingredients, setIngredients] = useState(() => recipe.ingredients.map(withKey));
  const [steps, setSteps] = useState(() => recipe.steps.map(withKey));
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.errors ?? {};
  const fieldKeys = ["title", "description", "ingredients", "steps"];
  const otherErrors = Object.entries(errors).filter(([k]) => !fieldKeys.includes(k));
  const describedBy = (key: string) => (errors[key] ? `draft-${key}-error` : undefined);

  const blankIngredient: Ingredient = { qty: null, unit: null, item: "", note: null };

  return (
    <form action={formAction} className="mx-auto max-w-2xl text-shef-navy">
      <input type="hidden" name="id" value={recipe.id} />

      {otherErrors.length > 0 && (
        <div role="alert" className="mb-4 rounded-lg border border-shef-orange bg-white p-3">
          <p className="font-semibold">Please fix the following:</p>
          <ul className="list-disc pl-6">
            {otherErrors.map(([key, message]) => (
              <li key={key}>
                {FIELD_LABELS[key] ? `${FIELD_LABELS[key]}: ` : ""}
                {message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label htmlFor="draft-title" className={label}>
          Title
        </label>
        <input
          id="draft-title"
          name="title"
          required
          maxLength={L.title}
          defaultValue={recipe.title}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={describedBy("title")}
          className={field}
        />
        <FieldError id="draft-title-error" message={errors.title} />
      </div>

      <div className="mt-4">
        <label htmlFor="draft-description" className={label}>
          Description
        </label>
        <textarea
          id="draft-description"
          name="description"
          rows={3}
          maxLength={L.description}
          defaultValue={recipe.description ?? ""}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={describedBy("description")}
          className={field}
        />
        <FieldError id="draft-description-error" message={errors.description} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="draft-servings" className={label}>
            Servings
          </label>
          <input
            id="draft-servings"
            name="base_servings"
            type="number"
            min={1}
            max={12}
            required
            defaultValue={recipe.base_servings}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="draft-prep" className={label}>
            Prep minutes
          </label>
          <input
            id="draft-prep"
            name="prep_minutes"
            type="number"
            min={0}
            defaultValue={recipe.prep_minutes ?? ""}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="draft-cook" className={label}>
            Cook minutes
          </label>
          <input
            id="draft-cook"
            name="cook_minutes"
            type="number"
            min={0}
            defaultValue={recipe.cook_minutes ?? ""}
            className={field}
          />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="draft-cuisine" className={label}>
          Cuisine
        </label>
        <select id="draft-cuisine" name="cuisine" defaultValue={recipe.cuisine ?? ""} className={field}>
          <option value="">None</option>
          {CUISINES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="mt-6">
        <legend className="text-lg font-bold">Ingredients</legend>
        <FieldError id="draft-ingredients-error" message={errors.ingredients} />
        <ol className="mt-2 space-y-4">
          {ingredients.map((ing, i) => {
            const n = i + 1;
            return (
              <li key={ing.key} className="rounded-lg border border-shef-navy/15 bg-white/60 p-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <label htmlFor={`ing-${ing.key}-qty`} className={label}>
                      <span className="sr-only">Ingredient {n} </span>Quantity
                    </label>
                    <input
                      id={`ing-${ing.key}-qty`}
                      name="ingredient_qty"
                      type="number"
                      step="any"
                      min={0}
                      defaultValue={ing.qty ?? ""}
                      className={field}
                    />
                  </div>
                  <div>
                    <label htmlFor={`ing-${ing.key}-unit`} className={label}>
                      <span className="sr-only">Ingredient {n} </span>Unit
                    </label>
                    <input id={`ing-${ing.key}-unit`} name="ingredient_unit" maxLength={L.unit} defaultValue={ing.unit ?? ""} className={field} />
                  </div>
                  <div className="col-span-2">
                    <label htmlFor={`ing-${ing.key}-item`} className={label}>
                      <span className="sr-only">Ingredient {n} </span>Item
                    </label>
                    <input
                      id={`ing-${ing.key}-item`}
                      name="ingredient_item"
                      required
                      maxLength={L.item}
                      defaultValue={ing.item}
                      className={field}
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <label htmlFor={`ing-${ing.key}-note`} className={label}>
                      <span className="sr-only">Ingredient {n} </span>Note
                    </label>
                    <input id={`ing-${ing.key}-note`} name="ingredient_note" maxLength={L.note} defaultValue={ing.note ?? ""} className={field} />
                  </div>
                </div>
                <button
                  type="button"
                  className={`${smallButton} mt-2`}
                  onClick={() => setIngredients((rows) => rows.filter((r) => r.key !== ing.key))}
                >
                  Remove ingredient {n}
                </button>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className={`${smallButton} mt-3`}
          disabled={ingredients.length >= L.ingredients}
          onClick={() => setIngredients((rows) => [...rows, withKey(blankIngredient)])}
        >
          Add ingredient
        </button>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-lg font-bold">Steps</legend>
        <FieldError id="draft-steps-error" message={errors.steps} />
        <ol className="mt-2 space-y-4">
          {steps.map((step, i) => {
            const n = i + 1;
            return (
              <li key={step.key}>
                <label htmlFor={`step-${step.key}`} className={label}>
                  Step {n}
                </label>
                <textarea id={`step-${step.key}`} name="step" required rows={2} maxLength={L.step} defaultValue={step.text} className={field} />
                <button
                  type="button"
                  className={`${smallButton} mt-2`}
                  onClick={() => setSteps((rows) => rows.filter((r) => r.key !== step.key))}
                >
                  Remove step {n}
                </button>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className={`${smallButton} mt-3`}
          disabled={steps.length >= L.steps}
          onClick={() => setSteps((rows) => [...rows, withKey({ text: "" })])}
        >
          Add step
        </button>
      </fieldset>

      <TagGroup legend="Diet tags" name="diet_tags" options={DIET_TAGS} selected={recipe.diet_tags} />
      <TagGroup legend="Allergens" name="allergens" options={ALLERGENS} selected={recipe.allergens} />
      <TagGroup legend="Categories" name="categories" options={CATEGORIES} selected={recipe.categories} />

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-full border-2 border-shef-orange px-6 font-semibold text-shef-orange hover:bg-shef-orange/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shef-orange disabled:opacity-60"
        >
          {recipe.status === "live" ? "Save changes" : "Save draft"}
        </button>
        <button
          type="submit"
          name="intent"
          value="publish"
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-full bg-shef-orange px-6 font-semibold text-white hover:bg-shef-orange-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shef-orange disabled:opacity-60"
        >
          Publish
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {pending ? "Saving…" : ""}
      </p>
    </form>
  );
}
