/** Zod-free filter helpers, safe to import from client components. */

export interface Filters {
  q: string;
  cuisine: string[];
  category: string[];
  diet: string[];
}

export const Q_MAX = 100;

/** The chip groups, in URL order. */
export const GROUP_KEYS = ["cuisine", "category", "diet"] as const;
export type Group = (typeof GROUP_KEYS)[number];

/** Stable query string (no leading "?"): keys q, cuisine, category, diet; values sorted. */
export function filtersToQuery(filters: Filters): string {
  const parts: string[] = [];
  if (filters.q) parts.push(`q=${encodeURIComponent(filters.q)}`);
  for (const key of GROUP_KEYS) {
    const values = [...new Set(filters[key])].sort();
    if (values.length > 0) parts.push(`${key}=${values.map(encodeURIComponent).join(",")}`);
  }
  return parts.join("&");
}

/** Path plus query, without a dangling "?" when there are no filters. */
export function filtersHref(basePath: string, filters: Filters): string {
  const qs = filtersToQuery(filters);
  return qs ? `${basePath}?${qs}` : basePath;
}
