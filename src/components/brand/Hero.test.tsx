import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Hero from "./Hero";

vi.mock("next/image", () => import("@/test/next-image-mock"));

function heroImage(): HTMLImageElement {
  const imgs = screen
    .getAllByRole("img", { name: /shef/i })
    .filter((img): img is HTMLImageElement => (img.getAttribute("src") ?? "").includes("/brand/shef-cooking"));
  expect(imgs).toHaveLength(1);
  return imgs[0];
}

describe("Hero", () => {
  it("shows Shef's kitchen photo as the hero image", () => {
    render(<Hero />);
    const img = heroImage();
    expect(img.getAttribute("alt") ?? "").toMatch(/shef/i);
    // Hero image is above the fold: loaded with priority (no lazy loading).
    expect(img).toHaveAttribute("data-priority", "true");
    // No layout shift: explicit dimensions or sizes for a fill image.
    const sized =
      (img.hasAttribute("width") && img.hasAttribute("height")) || img.hasAttribute("sizes");
    expect(sized).toBe(true);
  });

  it("does not use the old SVG avatar placeholder", () => {
    const { container } = render(<Hero />);
    for (const img of container.querySelectorAll("img")) {
      expect(img.getAttribute("src") ?? "").not.toContain("shef-avatar.svg");
    }
  });

  it("shows 'Hi, I'm Shef' heading", () => {
    render(<Hero />);
    expect(screen.getByRole("heading", { level: 1, name: /Hi, I['’]m Shef/ })).toBeInTheDocument();
  });

  it("shows tagline 'Raw plates, honest bites & foodie experiments'", () => {
    render(<Hero />);
    expect(screen.getByText("Raw plates, honest bites & foodie experiments")).toBeInTheDocument();
  });

  it("shows a handwritten note in the hand font", () => {
    const { container } = render(<Hero />);
    const notes = [...container.querySelectorAll<HTMLElement>('[class*="font-hand"]')];
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((n) => (n.textContent ?? "").trim().length > 0)).toBe(true);
  });

  it("'Browse recipes' links to /recipes with a 44px target", () => {
    render(<Hero />);
    const link = screen.getByRole("link", { name: "Browse recipes" });
    expect(link).toHaveAttribute("href", "/recipes");
    expect(link.className).toContain("min-h-11");
  });

  it("Instagram link warns it opens in a new tab", () => {
    render(<Hero />);
    const link = screen.getByRole("link", { name: /follow @shefmeetschef/i });
    expect(link).toHaveAttribute("href", "https://www.instagram.com/shefmeetschef/");
    expect(link).toHaveAttribute("target", "_blank");
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(link.className).toContain("min-h-11");
    expect(link).toHaveAccessibleName(/\(opens in new tab\)/);
    const hint = within(link).getByText("(opens in new tab)");
    expect(hint.className).toContain("sr-only");
  });
});
