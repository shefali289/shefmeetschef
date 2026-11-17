import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import MediaEmbeds from "./MediaEmbeds";

const REEL = "https://www.instagram.com/reel/ABC123/";
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function sandboxTokens(el: HTMLElement): string[] {
  return (el.getAttribute("sandbox") ?? "").split(/\s+/).filter(Boolean);
}

describe("MediaEmbeds", () => {
  it("builds iframe src only from parsed ids", () => {
    render(
      <MediaEmbeds
        title="Masala Chai"
        reelUrl="http://instagram.com/reel/ABC123?igsh=junk"
        youtubeUrl="https://youtu.be/dQw4w9WgXcQ?si=junk"
      />,
    );
    expect(screen.getByTitle("Instagram reel: Masala Chai")).toHaveAttribute(
      "src",
      "https://www.instagram.com/reel/ABC123/embed",
    );
    expect(screen.getByTitle("YouTube video: Masala Chai")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });

  it("iframes use a strict referrer policy and a sandbox without top navigation", () => {
    render(<MediaEmbeds title="Masala Chai" reelUrl={REEL} youtubeUrl={YT} />);
    const frames = [
      screen.getByTitle("Instagram reel: Masala Chai"),
      screen.getByTitle("YouTube video: Masala Chai"),
    ];
    for (const f of frames) {
      expect(f.tagName).toBe("IFRAME");
      expect(f).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      expect(f).toHaveAttribute("sandbox");
      const tokens = sandboxTokens(f);
      expect(tokens).toContain("allow-scripts");
      expect(tokens).not.toContain("allow-top-navigation");
    }
  });

  it("renders only the embeds that have a valid URL", () => {
    const { unmount } = render(<MediaEmbeds title="T" reelUrl={REEL} youtubeUrl={null} />);
    expect(screen.getByTitle("Instagram reel: T")).toBeInTheDocument();
    expect(screen.queryByTitle("YouTube video: T")).not.toBeInTheDocument();
    unmount();
    render(<MediaEmbeds title="T" reelUrl={null} youtubeUrl={YT} />);
    expect(screen.queryByTitle("Instagram reel: T")).not.toBeInTheDocument();
    expect(screen.getByTitle("YouTube video: T")).toBeInTheDocument();
  });

  it("renders nothing for off-host or javascript: URLs", () => {
    const { container } = render(
      <MediaEmbeds
        title="T"
        reelUrl="javascript:alert(1)//www.instagram.com/reel/ABC123/"
        youtubeUrl="https://www.youtube.com.evil.io/watch?v=dQw4w9WgXcQ"
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(container.querySelector("iframe")).toBeNull();
  });
});
