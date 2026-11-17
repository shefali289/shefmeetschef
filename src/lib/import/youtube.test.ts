import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { YouTubeError, YouTubeQuotaError, fetchYouTubeUploads } from "./youtube";

const KEY = "yt-test-key-xyz";
const CHANNEL = "UCshef123";
const UPLOADS = "UUshef123";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function urlOf(input: RequestInfo | URL): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
}

function keySent(input: RequestInfo | URL, init?: RequestInit) {
  return (
    urlOf(input).searchParams.get("key") === KEY ||
    new Headers(init?.headers).get("x-goog-api-key") === KEY
  );
}

const channelsResponse = {
  items: [{ id: CHANNEL, contentDetails: { relatedPlaylists: { uploads: UPLOADS } } }],
};

function item(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    snippet: {
      title,
      description: `${title}\n\nIngredients:\n- 1 cup rice`,
      publishedAt: "2026-10-05T12:00:00Z",
      resourceId: { kind: "youtube#video", videoId: id },
      thumbnails: {
        default: { url: `https://i.ytimg.com/vi/${id}/default.jpg` },
        medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` },
        high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` },
      },
      ...extra,
    },
  };
}

function routedFetch(playlistPages: unknown[]) {
  let page = 0;
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const u = urlOf(input);
    if (u.pathname.endsWith("/channels")) return json(channelsResponse);
    if (u.pathname.endsWith("/playlistItems")) return json(playlistPages[page++] ?? { items: [] });
    return json({ error: { code: 404, message: "not found" } }, 404);
  });
}

describe("fetchYouTubeUploads", () => {
  it("resolves channel uploads playlist then lists items with description", async () => {
    const fetchMock = routedFetch([{ items: [item("vid1", "Veg Biryani")] }]);
    await fetchYouTubeUploads({
      apiKey: KEY,
      channelId: CHANNEL,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [chInput, chInit] = fetchMock.mock.calls[0];
    const ch = urlOf(chInput);
    expect(ch.origin + ch.pathname).toBe("https://www.googleapis.com/youtube/v3/channels");
    expect(ch.searchParams.get("part")).toContain("contentDetails");
    expect(ch.searchParams.get("id")).toBe(CHANNEL);
    expect(keySent(chInput, chInit)).toBe(true);

    const [plInput, plInit] = fetchMock.mock.calls[1];
    const pl = urlOf(plInput);
    expect(pl.origin + pl.pathname).toBe("https://www.googleapis.com/youtube/v3/playlistItems");
    expect(pl.searchParams.get("part")).toContain("snippet");
    expect(pl.searchParams.get("playlistId")).toBe(UPLOADS);
    expect(keySent(plInput, plInit)).toBe(true);
  });

  it("follows nextPageToken", async () => {
    const fetchMock = routedFetch([
      { items: [item("vid1", "Veg Biryani")], nextPageToken: "PAGE2" },
      { items: [item("vid2", "Rasmalai")] },
    ]);
    const posts = await fetchYouTubeUploads({
      apiKey: KEY,
      channelId: CHANNEL,
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(urlOf(fetchMock.mock.calls[2][0]).searchParams.get("pageToken")).toBe("PAGE2");
    expect(posts.map((p) => p.youtube_id)).toEqual(["vid1", "vid2"]);
  });

  it("maps to import posts", async () => {
    const fetchMock = routedFetch([
      {
        items: [
          item("vid1", "Veg Biryani"),
          item("vid2", "Rasmalai", {
            thumbnails: { default: { url: "https://i.ytimg.com/vi/vid2/default.jpg" } },
          }),
        ],
      },
    ]);
    const posts = await fetchYouTubeUploads({
      apiKey: KEY,
      channelId: CHANNEL,
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(posts).toEqual([
      {
        youtube_id: "vid1",
        title: "Veg Biryani",
        description: "Veg Biryani\n\nIngredients:\n- 1 cup rice",
        url: "https://www.youtube.com/watch?v=vid1",
        thumbnail_url: "https://i.ytimg.com/vi/vid1/hqdefault.jpg",
        published_at: "2026-10-05T12:00:00Z",
      },
      {
        youtube_id: "vid2",
        title: "Rasmalai",
        description: "Rasmalai\n\nIngredients:\n- 1 cup rice",
        url: "https://www.youtube.com/watch?v=vid2",
        thumbnail_url: "https://i.ytimg.com/vi/vid2/default.jpg",
        published_at: "2026-10-05T12:00:00Z",
      },
    ]);
  });

  it("handles quota error as YouTubeQuotaError", async () => {
    const fetchMock = vi.fn(async () =>
      json(
        {
          error: {
            code: 403,
            message: "The request cannot be completed because you have exceeded your quota.",
            errors: [{ domain: "youtube.quota", reason: "quotaExceeded" }],
          },
        },
        403,
      ),
    );
    const err = await fetchYouTubeUploads({
      apiKey: KEY,
      channelId: CHANNEL,
      fetch: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YouTubeQuotaError);
    expect(String((err as Error).message)).not.toContain(KEY);
  });

  it("unknown channel is a YouTubeError, not a quota error", async () => {
    const fetchMock = vi.fn(async () => json({ items: [] }));
    const err = await fetchYouTubeUploads({
      apiKey: KEY,
      channelId: "UCnope",
      fetch: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YouTubeError);
    expect(err).not.toBeInstanceOf(YouTubeQuotaError);
  });
});
