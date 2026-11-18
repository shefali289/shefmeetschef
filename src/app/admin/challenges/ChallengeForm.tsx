"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { defaultChallengeWeek } from "@/lib/challenges/dates";
import type { ChallengeFormField, ChallengeFormState } from "@/lib/challenges/types";

export interface ChallengeFormRecipe {
  id: string;
  title: string;
  source: "shef" | "outside";
  status: "draft" | "live";
}

export interface ChallengeFormProps {
  /** Candidate base recipes; only live Shef recipes are offered. */
  recipes: ChallengeFormRecipe[];
  /** Default dates; falls back to defaultChallengeWeek() (Monday to Sunday NZ). */
  defaults?: { startsOn: string; endsOn: string };
  action: (prev: ChallengeFormState, formData: FormData) => Promise<ChallengeFormState>;
}

/** Fields in form order: focus goes to the first invalid one after a failed save. */
const FIELD_ORDER: ChallengeFormField[] = ["title", "description", "base_recipe_id", "starts_on", "ends_on"];

const input =
  "mt-1 block min-h-11 w-full rounded-xl border-2 border-cocoa/20 bg-white px-3 py-2 text-cocoa focus-visible:border-copper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper";
const label = "block font-bold text-cocoa";

/** The admin's create-challenge form. Validation is repeated on the server. */
export default function ChallengeForm({ recipes, defaults, action }: ChallengeFormProps) {
  const [week] = useState(() => defaults ?? defaultChallengeWeek());
  // React resets the form after each action; keep what was typed when the save failed.
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, formAction, pending] = useActionState(async (prev: ChallengeFormState, fd: FormData) => {
    const result = await action(prev, fd);
    setValues(result?.ok ? {} : Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])));
    return result;
  }, null);

  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const first = FIELD_ORDER.find((name) => state?.errors?.[name]);
    if (!first) return;
    formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }, [state]);

  const options = recipes.filter((r) => r.source === "shef" && r.status === "live");
  const errors = state?.errors ?? {};
  const errorFor = (name: ChallengeFormField) =>
    errors[name] ? (
      <p id={`${name}-error`} className="mt-1 font-semibold text-copper-ink">
        {errors[name]}
      </p>
    ) : null;
  const describe = (name: ChallengeFormField) =>
    errors[name] ? { "aria-invalid": true as const, "aria-describedby": `${name}-error` } : {};

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 rounded-[1.5rem] bg-white p-5 shadow-soft ring-1 ring-cocoa/10">
      <div>
        <label htmlFor="challenge-title" className={label}>
          Title
        </label>
        <input
          id="challenge-title"
          name="title"
          required
          maxLength={200}
          defaultValue={values.title ?? ""}
          className={input}
          {...describe("title")}
        />
        {errorFor("title")}
      </div>
      <div>
        <label htmlFor="challenge-description" className={label}>
          Description
        </label>
        <textarea
          id="challenge-description"
          name="description"
          maxLength={2000}
          rows={3}
          defaultValue={values.description ?? ""}
          className={input}
          {...describe("description")}
        />
        {errorFor("description")}
      </div>
      <div>
        <label htmlFor="challenge-base" className={label}>
          Base recipe
        </label>
        <select
          id="challenge-base"
          name="base_recipe_id"
          required
          defaultValue={values.base_recipe_id ?? ""}
          className={input}
          {...describe("base_recipe_id")}
        >
          <option value="">Choose a recipe</option>
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
        {errorFor("base_recipe_id")}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="challenge-starts" className={label}>
            Start date
          </label>
          <input
            id="challenge-starts"
            type="date"
            name="starts_on"
            required
            defaultValue={values.starts_on ?? week.startsOn}
            className={input}
            {...describe("starts_on")}
          />
          {errorFor("starts_on")}
        </div>
        <div>
          <label htmlFor="challenge-ends" className={label}>
            End date
          </label>
          <input
            id="challenge-ends"
            type="date"
            name="ends_on"
            required
            defaultValue={values.ends_on ?? week.endsOn}
            className={input}
            {...describe("ends_on")}
          />
          {errorFor("ends_on")}
        </div>
      </div>
      {errors.form && (
        <p role="alert" className="rounded-xl bg-blush-light p-3 font-semibold text-cocoa">
          {errors.form}
        </p>
      )}
      <div role="status" className="font-semibold text-herb">
        {state?.ok ? "Challenge created." : ""}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="press inline-flex min-h-11 items-center justify-center rounded-full bg-copper px-6 py-2 font-bold text-white shadow-soft hover:bg-copper-dark focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cocoa disabled:opacity-70"
      >
        {pending ? "Creating…" : "Create challenge"}
      </button>
    </form>
  );
}
