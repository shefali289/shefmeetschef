import { describe, expect, it } from "vitest";
import { outsideReelLabel, reelHandle } from "./handle";

describe("outside reel handle", () => {
  it("label is From @handle's reel when the URL has a handle", () => {
    expect(reelHandle("https://www.instagram.com/some.cook_1/reel/ABC123/")).toBe("some.cook_1");
    expect(outsideReelLabel("https://www.instagram.com/some.cook_1/reel/ABC123/")).toBe(
      "From @some.cook_1's reel",
    );
    expect(outsideReelLabel("https://instagram.com/NaniCooks/p/XYZ789/?igsh=1")).toBe(
      "From @NaniCooks's reel",
    );
  });

  it("label is From an outside reel otherwise", () => {
    for (const url of [
      "https://www.instagram.com/reel/ABC123/",
      "https://www.instagram.com/bad-handle!/reel/ABC123/",
      "https://www.instagram.com/a%3Cb%3E/reel/ABC123/",
      "https://evil.io/some.cook/reel/ABC123/",
      "not a url",
      "",
      null,
      undefined,
    ]) {
      expect(reelHandle(url), String(url)).toBeNull();
      expect(outsideReelLabel(url), String(url)).toBe("From an outside reel");
    }
  });
});
