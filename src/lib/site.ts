const FALLBACK = "http://localhost:3000";

/** Public site origin from NEXT_PUBLIC_SITE_URL; falls back to localhost if missing or not http(s). */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return FALLBACK;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return FALLBACK;
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return FALLBACK;
  }
}
