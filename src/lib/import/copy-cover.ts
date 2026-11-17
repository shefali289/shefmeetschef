// Pure helper: fetch and upload are injected.

export const COVER_BUCKET = "recipe-images";
export const MAX_COVER_BYTES = 5 * 1024 * 1024;

export interface CoverUpload {
  bucket: string;
  path: string;
  body: ArrayBuffer;
  contentType: string;
}

export interface CopyCoverOptions {
  url: string;
  slug: string;
  fetch: typeof fetch;
  /** Uploads the image and returns its public URL. */
  upload: (file: CoverUpload) => Promise<string>;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TIMEOUT_MS = 15_000;

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Copies a social thumbnail into Supabase Storage. Returns the public URL, or null on any failure. */
export async function copyCoverToStorage(options: CopyCoverOptions): Promise<string | null> {
  const { url, slug } = options;
  if (!SLUG.test(slug) || !isHttps(url)) return null;
  try {
    const res = await options.fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = EXTENSIONS[contentType];
    if (!ext) return null;
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_COVER_BYTES) return null;
    const body = await res.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_COVER_BYTES) return null;
    return await options.upload({ bucket: COVER_BUCKET, path: `${slug}.${ext}`, body, contentType });
  } catch {
    return null;
  }
}
