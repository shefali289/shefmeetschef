import "server-only";
import { z } from "zod";

/** The last import result is kept in a short-lived httpOnly cookie (no extra table needed). */
export const LAST_IMPORT_COOKIE = "smc_last_import";

/** Browsers cap a cookie at about 4 KB including its name and attributes. */
const MAX_ENCODED = 3400;
const MAX_REFS = 3;
const ID_MAX = 40;
const URL_MAX = 200;
const REF_ERROR_MAX = 80;
const ERROR_MAX = 150;

const SourceSchema = z.enum(["instagram", "youtube"]);

const HttpsUrl = z
  .string()
  .max(URL_MAX)
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:" && v.startsWith("https://");
    } catch {
      return false;
    }
  });

const RefSchema = z.object({
  source: SourceSchema,
  id: z.string().max(ID_MAX),
  url: HttpsUrl,
  error: z.string().max(REF_ERROR_MAX).optional(),
});

const LastImportSchema = z.object({
  at: z.string().max(40),
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative().default(0),
  noRecipeCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  noRecipe: z.array(RefSchema).max(MAX_REFS),
  failed: z.array(RefSchema).max(MAX_REFS),
  sourceErrors: z
    .array(z.object({ source: SourceSchema, error: z.string().max(ERROR_MAX) }))
    .max(2)
    .default([]),
  error: z.string().max(ERROR_MAX).optional(),
});

export type LastImport = z.infer<typeof LastImportSchema>;
type Ref = z.infer<typeof RefSchema>;

/** What importNow hands over: an ImportSummary (or an error) plus when it ran. */
export interface LastImportInput {
  at: string;
  imported: number;
  skipped: number;
  remaining?: number;
  noRecipe: { source: Ref["source"]; id: string; url: string }[];
  failed: { source: Ref["source"]; id: string; url: string; error?: string }[];
  sourceErrors?: { source: Ref["source"]; error: string }[];
  error?: string;
}

function trimRefs(refs: LastImportInput["failed"], limit: number): Ref[] {
  return refs
    .filter((r) => HttpsUrl.safeParse(r.url.slice(0, URL_MAX)).success)
    .slice(0, limit)
    .map((r) => ({
      source: r.source,
      id: r.id.slice(0, ID_MAX),
      url: r.url.slice(0, URL_MAX),
      ...(r.error !== undefined ? { error: r.error.slice(0, REF_ERROR_MAX) } : {}),
    }));
}

/** Cookie value: URI-encoded JSON with full counts but only a few short refs. */
export function encodeLastImport(input: LastImportInput): string {
  const build = (limit: number): LastImport => ({
    at: input.at.slice(0, 40),
    imported: input.imported,
    skipped: input.skipped,
    remaining: input.remaining ?? 0,
    noRecipeCount: input.noRecipe.length,
    failedCount: input.failed.length,
    noRecipe: trimRefs(input.noRecipe, limit),
    failed: trimRefs(input.failed, limit),
    sourceErrors: (input.sourceErrors ?? [])
      .slice(0, 2)
      .map((e) => ({ source: e.source, error: e.error.slice(0, ERROR_MAX) })),
    ...(input.error !== undefined ? { error: input.error.slice(0, ERROR_MAX) } : {}),
  });
  // Drop refs one at a time if odd characters made the encoded value too long.
  for (let limit = MAX_REFS; ; limit--) {
    const raw = encodeURIComponent(JSON.stringify(build(limit)));
    if (raw.length < MAX_ENCODED || limit === 0) return raw;
  }
}

/** Parses the cookie; anything malformed or tampered with is treated as "no summary". */
export function decodeLastImport(raw: string | undefined): LastImport | null {
  if (!raw) return null;
  try {
    const parsed = LastImportSchema.safeParse(JSON.parse(decodeURIComponent(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

interface CookieStore {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: Record<string, unknown>): unknown;
}

/*
 * Next's cookie store URI-encodes values when writing and decodes when reading, so the JSON is
 * handed over decoded: the Set-Cookie header then carries exactly encodeLastImport()'s value.
 */
export function writeLastImportCookie(store: CookieStore, input: LastImportInput): void {
  store.set(LAST_IMPORT_COOKIE, decodeURIComponent(encodeLastImport(input)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function readLastImportCookie(store: CookieStore): LastImport | null {
  const value = store.get(LAST_IMPORT_COOKIE)?.value;
  return value ? decodeLastImport(encodeURIComponent(value)) : null;
}
