// Pure helper: no "server-only" needed.

const MAX_LENGTH = 80;

/** URL-safe slug: lowercase ascii words joined by single hyphens, at most 80 characters. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, "");
  return slug || "recipe";
}

/** slugify(title), with -2, -3, ... appended until it is not in `existing`. */
export function uniqueSlug(title: string, existing: Set<string>): string {
  const base = slugify(title);
  if (!existing.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, MAX_LENGTH - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
}
