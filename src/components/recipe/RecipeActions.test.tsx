import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RecipeActions from "./RecipeActions";

const REEL = "https://www.instagram.com/reel/ABC123/";
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("RecipeActions", () => {
  it("shows Watch the reel only with reel_url", () => {
    const { unmount } = render(<RecipeActions reelUrl={REEL} youtubeUrl={null} />);
    expect(screen.getByRole("link", { name: /watch the reel/i })).toHaveAttribute("href", REEL);
    unmount();
    render(<RecipeActions reelUrl={null} youtubeUrl={YT} />);
    expect(screen.queryByRole("link", { name: /watch the reel/i })).not.toBeInTheDocument();
  });

  it("shows Watch on YouTube only with youtube_url", () => {
    const { unmount } = render(<RecipeActions reelUrl={null} youtubeUrl={YT} />);
    expect(screen.getByRole("link", { name: /watch on youtube/i })).toHaveAttribute("href", YT);
    unmount();
    render(<RecipeActions reelUrl={REEL} youtubeUrl={null} />);
    expect(screen.queryByRole("link", { name: /watch on youtube/i })).not.toBeInTheDocument();
  });

  it("hides buttons for unsafe or off-host URLs", () => {
    render(
      <RecipeActions
        reelUrl="javascript:alert(1)//www.instagram.com/reel/ABC123/"
        youtubeUrl="https://www.youtube.com.evil.io/watch?v=dQw4w9WgXcQ"
      />,
    );
    expect(screen.queryByRole("link", { name: /watch the reel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /watch on youtube/i })).not.toBeInTheDocument();
  });

  it("Follow @shefmeetschef links to instagram.com/shefmeetschef", () => {
    render(<RecipeActions reelUrl={null} youtubeUrl={null} />);
    const follow = screen.getByRole("link", { name: /follow @shefmeetschef/i });
    expect(follow.getAttribute("href")).toMatch(/^https:\/\/(www\.)?instagram\.com\/shefmeetschef\/?$/);
  });

  it("external links use rel noopener noreferrer", () => {
    render(<RecipeActions reelUrl={REEL} youtubeUrl={YT} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const a of links) {
      const rel = (a.getAttribute("rel") ?? "").split(/\s+/);
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
      expect(a).toHaveAttribute("target", "_blank");
    }
  });
});

describe("RecipeActions canonical links", () => {
  it("links to canonical URLs rebuilt from the parsed id", () => {
    render(
      <RecipeActions
        reelUrl="http://instagram.com/reel/ABC123?igsh=junk&utm_source=x"
        youtubeUrl="http://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&utm_source=x"
      />,
    );
    expect(screen.getByRole("link", { name: /watch the reel/i })).toHaveAttribute(
      "href",
      "https://www.instagram.com/reel/ABC123/",
    );
    expect(screen.getByRole("link", { name: /watch on youtube/i })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("canonicalises youtu.be and shorts links too", () => {
    const { unmount } = render(<RecipeActions reelUrl={null} youtubeUrl="https://youtu.be/dQw4w9WgXcQ?si=x" />);
    expect(screen.getByRole("link", { name: /watch on youtube/i })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    unmount();
    render(<RecipeActions reelUrl={null} youtubeUrl="https://www.youtube.com/shorts/aB3_-xYz012" />);
    expect(screen.getByRole("link", { name: /watch on youtube/i })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=aB3_-xYz012",
    );
  });
});
