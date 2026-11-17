import "server-only";

export interface InstagramPost {
  instagram_id: string;
  caption: string;
  permalink: string;
  thumbnail_url: string | null;
  media_type: "VIDEO" | "IMAGE" | "CAROUSEL_ALBUM";
  timestamp: string;
}

export interface FetchInstagramOptions {
  accessToken: string;
  fetch: typeof fetch;
  /** Maximum number of posts to return across all pages. */
  limit?: number;
}

export class InstagramError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "InstagramError";
    this.status = status;
  }
}

/** The access token is expired or invalid (Graph error code 190). */
export class InstagramTokenError extends InstagramError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "InstagramTokenError";
  }
}

const GRAPH_HOST = "graph.instagram.com";
const FIELDS = "id,caption,permalink,media_type,thumbnail_url,media_url,timestamp";
const KEPT_TYPES = new Set(["VIDEO", "IMAGE", "CAROUSEL_ALBUM"]);
const DEFAULT_LIMIT = 100;
const MAX_PAGES = 20;

interface RawMedia {
  id: string;
  caption?: string;
  permalink?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp?: string;
}

interface MediaPage {
  data?: RawMedia[];
  paging?: { next?: string };
  error?: { message?: string; code?: number };
}

function toPost(m: RawMedia): InstagramPost | null {
  if (!m.media_type || !KEPT_TYPES.has(m.media_type)) return null;
  if (!m.caption || !m.caption.trim() || !m.permalink) return null;
  return {
    instagram_id: m.id,
    caption: m.caption,
    permalink: m.permalink,
    thumbnail_url: m.thumbnail_url ?? m.media_url ?? null,
    media_type: m.media_type as InstagramPost["media_type"],
    timestamp: m.timestamp ?? "",
  };
}

/** Only follow paging links back to the Graph API over https, so the token never leaks. */
function safeNext(next: string | undefined): string | null {
  if (!next) return null;
  try {
    const u = new URL(next);
    return u.protocol === "https:" && u.hostname === GRAPH_HOST ? u.href : null;
  } catch {
    return null;
  }
}

/** Shef's Instagram posts with captions, newest first, following paging up to `limit`. */
export async function fetchInstagramMedia(options: FetchInstagramOptions): Promise<InstagramPost[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const first = new URL(`https://${GRAPH_HOST}/me/media`);
  first.searchParams.set("fields", FIELDS);
  first.searchParams.set("access_token", options.accessToken);

  const posts: InstagramPost[] = [];
  let url: string | null = first.href;
  for (let page = 0; url && page < MAX_PAGES && posts.length < limit; page++) {
    const res = await options.fetch(url);
    const body = (await res.json().catch(() => ({}))) as MediaPage;
    if (!res.ok || body.error) {
      const code = body.error?.code;
      if (code === 190) {
        throw new InstagramTokenError("Instagram access token has expired or is invalid", res.status);
      }
      throw new InstagramError(`Instagram request failed with status ${res.status}`, res.status);
    }
    for (const m of body.data ?? []) {
      const post = toPost(m);
      if (post) posts.push(post);
      if (posts.length >= limit) break;
    }
    url = safeNext(body.paging?.next);
  }
  return posts;
}
