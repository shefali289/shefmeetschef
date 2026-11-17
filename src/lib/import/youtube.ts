import "server-only";

export interface YouTubePost {
  youtube_id: string;
  title: string;
  description: string;
  url: string;
  thumbnail_url: string | null;
  published_at: string;
}

export interface FetchYouTubeOptions {
  apiKey: string;
  channelId: string;
  fetch: typeof fetch;
}

export class YouTubeError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "YouTubeError";
    this.status = status;
  }
}

/** Daily Data API quota used up (403, reason quotaExceeded). */
export class YouTubeQuotaError extends YouTubeError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "YouTubeQuotaError";
  }
}

const API = "https://www.googleapis.com/youtube/v3";
const MAX_PAGES = 10;

interface Thumb {
  url?: string;
}

interface PlaylistItem {
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    resourceId?: { videoId?: string };
    thumbnails?: { default?: Thumb; medium?: Thumb; high?: Thumb; standard?: Thumb; maxres?: Thumb };
  };
}

interface ApiError {
  error?: { code?: number; errors?: { reason?: string }[] };
}

/** GET a Data API endpoint with the key in a header, so it never appears in URLs or logs. */
async function get<T>(options: FetchYouTubeOptions, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await options.fetch(url.href, { headers: { "x-goog-api-key": options.apiKey } });
  const body = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok || body.error) {
    const quota = body.error?.errors?.some((e) => e.reason === "quotaExceeded" || e.reason === "dailyLimitExceeded");
    if (quota) throw new YouTubeQuotaError("YouTube Data API daily quota exceeded", res.status);
    throw new YouTubeError(`YouTube request failed with status ${res.status}`, res.status);
  }
  return body;
}

function toPost(item: PlaylistItem): YouTubePost | null {
  const s = item.snippet;
  const id = s?.resourceId?.videoId;
  if (!s || !id) return null;
  const t = s.thumbnails ?? {};
  return {
    youtube_id: id,
    title: s.title ?? "",
    description: s.description ?? "",
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    thumbnail_url: t.high?.url ?? t.medium?.url ?? t.default?.url ?? null,
    published_at: s.publishedAt ?? "",
  };
}

/** Videos in the channel's uploads playlist, following nextPageToken. */
export async function fetchYouTubeUploads(options: FetchYouTubeOptions): Promise<YouTubePost[]> {
  const channels = await get<{
    items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
  }>(options, "channels", { part: "contentDetails", id: options.channelId });
  const uploads = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new YouTubeError("YouTube channel not found");

  const posts: YouTubePost[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = { part: "snippet", playlistId: uploads, maxResults: "50" };
    if (pageToken) params.pageToken = pageToken;
    const body = await get<{ items?: PlaylistItem[]; nextPageToken?: string }>(options, "playlistItems", params);
    for (const item of body.items ?? []) {
      const post = toPost(item);
      if (post) posts.push(post);
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return posts;
}
