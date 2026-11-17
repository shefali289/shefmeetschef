import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { InstagramError, InstagramTokenError, fetchInstagramMedia } from "./instagram";

const TOKEN = "IGQ-test-token-abc";

const reel = {
  id: "1790001",
  caption: "Paneer tikka in the air fryer 🔥\n200 g paneer\n2 tbsp yoghurt",
  permalink: "https://www.instagram.com/reel/ABC123/",
  media_type: "VIDEO",
  media_url: "https://cdninstagram.example/v/abc.mp4",
  thumbnail_url: "https://cdninstagram.example/t/abc.jpg",
  timestamp: "2026-10-01T10:00:00+0000",
};
const image = {
  id: "1790002",
  caption: "Mango lassi\n1 cup mango\n1 cup yoghurt",
  permalink: "https://www.instagram.com/p/DEF456/",
  media_type: "IMAGE",
  media_url: "https://cdninstagram.example/i/def.jpg",
  timestamp: "2026-09-20T08:00:00+0000",
};
const carousel = {
  id: "1790003",
  caption: "Diwali sweets 3 ways",
  permalink: "https://www.instagram.com/p/GHI789/",
  media_type: "CAROUSEL_ALBUM",
  media_url: "https://cdninstagram.example/i/ghi.jpg",
  timestamp: "2026-09-10T08:00:00+0000",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function urlOf(input: RequestInfo | URL): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
}

function tokenSent(input: RequestInfo | URL, init?: RequestInit): boolean {
  const u = urlOf(input);
  const auth = new Headers(init?.headers).get("authorization");
  return u.searchParams.get("access_token") === TOKEN || auth === `Bearer ${TOKEN}`;
}

function pagedFetch(pages: unknown[]) {
  let i = 0;
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(pages[i++] ?? { data: [] }));
}

describe("fetchInstagramMedia", () => {
  it("requests /me/media on graph.instagram.com with caption, permalink, media_type, thumbnail_url, media_url, timestamp fields", async () => {
    const fetchMock = pagedFetch([{ data: [reel] }]);
    await fetchInstagramMedia({ accessToken: TOKEN, fetch: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    const u = urlOf(input);
    expect(u.protocol).toBe("https:");
    expect(u.hostname).toBe("graph.instagram.com");
    expect(u.pathname).toMatch(/^(\/v\d+\.\d+)?\/me\/media$/);
    const fields = (u.searchParams.get("fields") ?? "").split(",").map((f) => f.trim());
    for (const f of ["id", "caption", "permalink", "media_type", "thumbnail_url", "media_url", "timestamp"]) {
      expect(fields).toContain(f);
    }
    expect(tokenSent(input, init)).toBe(true);
  });

  it("follows paging.next", async () => {
    const next = `https://graph.instagram.com/v23.0/17841/media?access_token=${TOKEN}&after=CURSOR2`;
    const fetchMock = pagedFetch([
      { data: [reel], paging: { cursors: { after: "CURSOR2" }, next } },
      { data: [image], paging: { cursors: { after: "CURSOR3" } } },
    ]);
    const posts = await fetchInstagramMedia({
      accessToken: TOKEN,
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlOf(fetchMock.mock.calls[1][0]).href).toBe(next);
    expect(posts.map((p) => p.instagram_id)).toEqual(["1790001", "1790002"]);
  });

  it("stops paging once limit posts are collected", async () => {
    const next = `https://graph.instagram.com/v23.0/17841/media?access_token=${TOKEN}&after=C2`;
    const fetchMock = pagedFetch([
      { data: [reel, image], paging: { next } },
      { data: [carousel], paging: { next } },
    ]);
    const posts = await fetchInstagramMedia({
      accessToken: TOKEN,
      fetch: fetchMock as unknown as typeof fetch,
      limit: 2,
    });
    expect(posts).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not follow paging.next to another host (token would leak)", async () => {
    const fetchMock = pagedFetch([
      { data: [reel], paging: { next: "https://evil.example/steal?x=1" } },
      { data: [image] },
    ]);
    const posts = await fetchInstagramMedia({
      accessToken: TOKEN,
      fetch: fetchMock as unknown as typeof fetch,
    }).catch(() => null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const [input] of fetchMock.mock.calls) {
      expect(urlOf(input).hostname).toBe("graph.instagram.com");
    }
    if (posts) expect(posts.map((p) => p.instagram_id)).toEqual(["1790001"]);
  });

  it("maps to import posts", async () => {
    const fetchMock = pagedFetch([{ data: [reel, image] }]);
    const posts = await fetchInstagramMedia({
      accessToken: TOKEN,
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(posts).toEqual([
      {
        instagram_id: "1790001",
        caption: reel.caption,
        permalink: reel.permalink,
        thumbnail_url: reel.thumbnail_url,
        media_type: "VIDEO",
        timestamp: reel.timestamp,
      },
      {
        // images have no thumbnail_url: fall back to media_url
        instagram_id: "1790002",
        caption: image.caption,
        permalink: image.permalink,
        thumbnail_url: image.media_url,
        media_type: "IMAGE",
        timestamp: image.timestamp,
      },
    ]);
  });

  it("only keeps VIDEO and CAROUSEL_ALBUM/IMAGE posts with captions", async () => {
    const fetchMock = pagedFetch([
      {
        data: [
          reel,
          image,
          carousel,
          { ...reel, id: "nocap", caption: undefined },
          { ...reel, id: "blank", caption: "   \n " },
          { ...reel, id: "story", media_type: "STORY" },
        ],
      },
    ]);
    const posts = await fetchInstagramMedia({
      accessToken: TOKEN,
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(posts.map((p) => p.instagram_id)).toEqual(["1790001", "1790002", "1790003"]);
    expect(posts.map((p) => p.media_type)).toEqual(["VIDEO", "IMAGE", "CAROUSEL_ALBUM"]);
  });

  it("surfaces expired-token error as InstagramTokenError", async () => {
    const fetchMock = vi.fn(async () =>
      json(
        {
          error: {
            message: "Error validating access token: Session has expired on Friday.",
            type: "OAuthException",
            code: 190,
            error_subcode: 463,
          },
        },
        400,
      ),
    );
    const err = await fetchInstagramMedia({
      accessToken: TOKEN,
      fetch: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InstagramTokenError);
    expect(String((err as Error).message)).not.toContain(TOKEN);
  });

  it("other API errors are InstagramError but not InstagramTokenError", async () => {
    const fetchMock = vi.fn(async () =>
      json({ error: { message: "Unsupported request", type: "IGApiException", code: 100 } }, 500),
    );
    const err = await fetchInstagramMedia({
      accessToken: TOKEN,
      fetch: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InstagramError);
    expect(err).not.toBeInstanceOf(InstagramTokenError);
  });
});
