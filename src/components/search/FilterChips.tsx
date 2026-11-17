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
          <legend className="mb-2 text-sm font-bold uppercase tracking-wide text-shef-navy">
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
                  className={`inline-flex min-h-11 items-center rounded-full border-2 px-4 font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-shef-navy ${
                    pressed
                      ? "border-shef-orange bg-shef-orange text-white"
                      : "border-shef-orange bg-white text-shef-navy hover:bg-shef-cream"
                  }`}
                >
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
