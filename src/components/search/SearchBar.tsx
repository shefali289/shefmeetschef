"use client";

import { useRouter } from "next/navigation";
import { filtersHref, GROUP_KEYS, Q_MAX, type Filters } from "@/lib/filters-query";

export default function SearchBar({
  filters,
  basePath = "/recipes",
}: {
  filters: Filters;
  basePath?: string;
}) {
  const router = useRouter();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = new FormData(event.currentTarget).get("q");
    const q = typeof raw === "string" ? raw.trim().slice(0, Q_MAX) : "";
    router.push(filtersHref(basePath, { ...filters, q }));
  }

  return (
    <form role="search" action={basePath} method="get" onSubmit={onSubmit} className="flex gap-2">
      <label htmlFor="recipe-search" className="sr-only">
        Search recipes
      </label>
      <input
        id="recipe-search"
        type="search"
        name="q"
        maxLength={Q_MAX}
        defaultValue={filters.q}
        placeholder="Search chai, paneer, noodles..."
        className="min-h-11 w-full min-w-0 flex-1 rounded-full border-2 border-shef-orange bg-white px-4 text-shef-navy placeholder:text-shef-navy/70 focus-visible:border-shef-orange focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-shef-navy"
      />
      {/* Keep the current filters when the form is submitted without JavaScript. */}
      {GROUP_KEYS.flatMap((key) =>
        filters[key].map((value) => <input key={`${key}-${value}`} type="hidden" name={key} value={value} />),
      )}
      <button
        type="submit"
        className="inline-flex min-h-11 items-center rounded-full bg-shef-orange px-5 font-semibold text-white hover:bg-shef-orange-dark focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-shef-navy"
      >
        Search
      </button>
    </form>
  );
}
