const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function parseHttps(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** Embed URL for an Instagram reel or post, or null if the URL is not one. */
export function instagramEmbedUrl(url: string): string | null {
  const u = parseHttps(url);
  if (!u || !INSTAGRAM_HOSTS.has(u.hostname)) return null;
  const m = u.pathname.match(/^\/(reel|p|tv)\/([A-Za-z0-9_-]+)\/?$/);
  return m ? `https://www.instagram.com/${m[1]}/${m[2]}/embed` : null;
}

/** 11-character YouTube video id from a watch, youtu.be or shorts URL, or null. */
export function youtubeEmbedId(url: string): string | null {
  const u = parseHttps(url);
  if (!u) return null;
  let id: string | null = null;
  if (u.hostname === "youtu.be") {
    id = u.pathname.slice(1).replace(/\/$/, "");
  } else if (YOUTUBE_HOSTS.has(u.hostname)) {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else id = u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)\/?$/)?.[1] ?? null;
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** Clean public link to an Instagram post, rebuilt from the parsed id, or null. */
export function instagramCanonicalUrl(url: string): string | null {
  const embed = instagramEmbedUrl(url);
  return embed ? embed.replace(/embed$/, "") : null;
}

/** Clean YouTube watch link rebuilt from the parsed id, or null. */
export function youtubeCanonicalUrl(url: string): string | null {
  const id = youtubeEmbedId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

/** YouTube thumbnail for a video URL, or null. */
export function youtubeThumbnailUrl(url: string): string | null {
  const id = youtubeEmbedId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}
