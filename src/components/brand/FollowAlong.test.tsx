import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import FollowAlong from "./FollowAlong";

vi.mock("next/image", () => import("@/test/next-image-mock"));

const INSTAGRAM = "https://www.instagram.com/shefmeetschef/";
// Handle confirmed by Shefali: @shefmeetschef.
const YOUTUBE = "https://www.youtube.com/@shefmeetschef";

function expectExternal(link: HTMLElement, href: string) {
  expect(link).toHaveAttribute("href", href);
  expect(link).toHaveAttribute("target", "_blank");
  const rel = (link.getAttribute("rel") ?? "").split(/\s+/);
  expect(rel).toContain("noopener");
  expect(rel).toContain("noreferrer");
  expect(link).toHaveAccessibleName(/\(opens in new tab\)/);
  expect(within(link).getByText("(opens in new tab)").className).toContain("sr-only");
  // WCAG 2.2 44px tap target.
  expect(link.className).toContain("min-h-11");
}

describe("FollowAlong", () => {
  it("is a labelled section with a heading", () => {
    render(<FollowAlong />);
    const heading = screen.getByRole("heading", { name: /follow along/i });
    expect(heading).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /follow along/i })).toBeInTheDocument();
  });

  it("links to Instagram in a new tab", () => {
    render(<FollowAlong />);
    expectExternal(screen.getByRole("link", { name: /instagram/i }), INSTAGRAM);
  });

  it("links to YouTube in a new tab", () => {
    render(<FollowAlong />);
    expectExternal(screen.getByRole("link", { name: /youtube/i }), YOUTUBE);
  });

  it("only links to Shef's own channels", () => {
    render(<FollowAlong />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(new Set(hrefs)).toEqual(new Set([INSTAGRAM, YOUTUBE]));
  });

  it("shows the follow card photo", () => {
    const { container } = render(<FollowAlong />);
    const imgs = [...container.querySelectorAll("img")].filter((img) =>
      (img.getAttribute("src") ?? "").includes("/brand/follow-card"),
    );
    expect(imgs).toHaveLength(1);
    // Must have an alt attribute (meaningful or empty if purely decorative), never missing.
    expect(imgs[0].hasAttribute("alt")).toBe(true);
  });
});
