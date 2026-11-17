const BASE = "http://same-site.invalid";

/** Returns `next` if it is a same-site relative path, otherwise "/". */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return "/";
  // No protocol-relative paths, backslashes or control characters (browsers strip tabs/newlines).
  if (next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  try {
    if (new URL(next, BASE).origin !== BASE) return "/";
  } catch {
    return "/";
  }
  return next;
}
