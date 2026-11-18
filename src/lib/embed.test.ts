import { describe, expect, it } from "vitest";
import { instagramCanonicalUrl, instagramEmbedUrl, youtubeEmbedId } from "./embed";

describe("instagramEmbedUrl", () => {
  it("builds Instagram embed URL from reel permalink", () => {
    expect(instagramEmbedUrl("https://www.instagram.com/reel/ABC123/")).toBe(
      "https://www.instagram.com/reel/ABC123/embed",
    );
    expect(instagramEmbedUrl("https://instagram.com/reel/ABC123")).toBe(
      "https://www.instagram.com/reel/ABC123/embed",
    );
    expect(instagramEmbedUrl("https://www.instagram.com/reel/A_b-9/?igsh=xyz")).toBe(
      "https://www.instagram.com/reel/A_b-9/embed",
    );
    expect(instagramEmbedUrl("https://www.instagram.com/p/XYZ789/")).toBe(
      "https://www.instagram.com/p/XYZ789/embed",
    );
  });
});

describe("youtubeEmbedId", () => {
  it("extracts YouTube id from watch, youtu.be and shorts URLs", () => {
    expect(youtubeEmbedId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeEmbedId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s")).toBe("dQw4w9WgXcQ");
    expect(youtubeEmbedId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeEmbedId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeEmbedId("https://youtu.be/dQw4w9WgXcQ?si=abc")).toBe("dQw4w9WgXcQ");
    expect(youtubeEmbedId("https://www.youtube.com/shorts/aB3_-xYz012")).toBe("aB3_-xYz012");
  });
});

describe("host allow-list", () => {
  it("rejects non-Instagram/YouTube hosts", () => {
    const badInstagram = [
      "https://instagram.com.evil.io/reel/ABC123/",
      "https://evilinstagram.com/reel/ABC123/",
      "https://evil.io/www.instagram.com/reel/ABC123/",
      "https://evil.io/?u=https://www.instagram.com/reel/ABC123/",
      "javascript:alert(1)//www.instagram.com/reel/ABC123/",
      "data:text/html,<script>alert(1)</script>",
      "https://www.instagram.com/shefmeetschef/", // profile, not a post
      "https://www.instagram.com/reel/\"><script>/",
      "not a url",
      "",
    ];
    for (const url of badInstagram) expect(instagramEmbedUrl(url), url).toBeNull();

    const badYouTube = [
      "https://www.youtube.com.evil.io/watch?v=dQw4w9WgXcQ",
      "https://youtu.be.evil.io/dQw4w9WgXcQ",
      "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
      "https://evil.io/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)//youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=<script>",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/",
      "not a url",
      "",
    ];
    for (const url of badYouTube) expect(youtubeEmbedId(url), url).toBeNull();
  });
});

describe("Instagram links with a handle", () => {
  it("accepts instagram.com/<handle>/reel/<id> links", () => {
    expect(instagramEmbedUrl("https://www.instagram.com/some.cook_1/reel/ABC123/")).toBe(
      "https://www.instagram.com/reel/ABC123/embed",
    );
    expect(instagramEmbedUrl("https://instagram.com/some.cook_1/reel/ABC123?igsh=xyz")).toBe(
      "https://www.instagram.com/reel/ABC123/embed",
    );
    expect(instagramEmbedUrl("https://www.instagram.com/SomeCook/p/XYZ789/")).toBe(
      "https://www.instagram.com/p/XYZ789/embed",
    );
    // the canonical link keeps the handle (so the card can say whose reel it is) but drops the query
    expect(instagramCanonicalUrl("https://www.instagram.com/some.cook_1/reel/ABC123/?igsh=xyz&utm=1")).toBe(
      "https://www.instagram.com/some.cook_1/reel/ABC123/",
    );
    // links without a handle are unchanged
    expect(instagramCanonicalUrl("https://instagram.com/reel/ABC123?igsh=x")).toBe(
      "https://www.instagram.com/reel/ABC123/",
    );
  });

  it("rejects handles with invalid characters", () => {
    const bad = [
      "https://www.instagram.com/bad-handle/reel/ABC123/",
      "https://www.instagram.com/bad!handle/reel/ABC123/",
      "https://www.instagram.com/a%3Cscript%3E/reel/ABC123/",
      "https://www.instagram.com/a%2Fb/reel/ABC123/",
      `https://www.instagram.com/${"a".repeat(31)}/reel/ABC123/`,
      "https://www.instagram.com/one/two/reel/ABC123/",
      "https://www.instagram.com/some.cook/reel/ABC123/extra/",
      "https://www.instagram.com/some.cook/stories/ABC123/",
      "https://evil.io/some.cook/reel/ABC123/",
    ];
    for (const url of bad) {
      expect(instagramEmbedUrl(url), url).toBeNull();
      expect(instagramCanonicalUrl(url), url).toBeNull();
    }
  });
});
