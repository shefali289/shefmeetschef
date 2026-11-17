"use client";

import { useRouter } from "next/navigation";
import { filtersHref, type Filters, type Group } from "@/lib/filters-query";
import { humanLabel } from "@/lib/labels";
import { CATEGORIES, CUISINES, DIET_TAGS } from "@/lib/taxonomy";

const GROUPS: { key: Group; label: string; values: readonly string[] }[] = [
  { key: "cuisine", label: "Cuisine", values: CUISINES },
  { key: "category", label: "Category", values: CATEGORIES },
  { key: "diet", label: "Diet", values: DIET_TAGS },
];

function Check() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-4 w-4 text-copper">
      <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function FilterChips({ filters, basePath }: { filters: Filters; basePath: string }) {
  const router = useRouter();

  function toggle(group: Group, value: string) {
    const current = filters[group];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    router.push(filtersHref(basePath, { ...filters, [group]: next }), { scroll: false });
  }

  return (
    <div className="flex flex-col gap-4">
      {GROUPS.map((group) => (
        <fieldset key={group.key}>
          <legend className="mb-2 font-hand text-2xl leading-none text-cocoa">
            {group.label}
          </legend>
          <div className="flex flex-wrap gap-2">
            {group.values.map((value) => {
              const pressed = filters[group.key].includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => toggle(group.key, value)}
                  className={`press inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 px-4 font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper ${
                    pressed
                      ? "border-copper bg-blush-light text-cocoa shadow-soft"
                      : "border-cocoa/40 bg-white/90 text-cocoa hover:border-copper hover:bg-blush-light/60"
                  }`}
                >
                  {pressed && <Check />}
                  {humanLabel(value)}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
