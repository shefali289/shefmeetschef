import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SiteFooter from "./SiteFooter";

vi.mock("next/image", () => import("@/test/next-image-mock"));

afterEach(() => {
  vi.useRealTimers();
});

describe("SiteFooter", () => {
  it("is the contentinfo landmark", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("says 'good food, good mood'", () => {
    render(<SiteFooter />);
    expect(within(screen.getByRole("contentinfo")).getByText(/good food, good mood/i)).toBeInTheDocument();
  });

  it("has Instagram and YouTube follow links that open in a new tab", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    const cases: [RegExp, string][] = [
      [/instagram/i, "https://www.instagram.com/shefmeetschef/"],
      [/youtube/i, "https://www.youtube.com/@shefmeetschef"],
    ];
    for (const [name, href] of cases) {
      const link = within(footer).getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      const rel = link.getAttribute("rel") ?? "";
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
      expect(link).toHaveAccessibleName(/\(opens in new tab\)/);
      expect(link.className).toContain("min-h-11");
    }
  });

  it("shows the copyright with the current year", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-03-04T10:00:00Z"));
    render(<SiteFooter />);
    expect(within(screen.getByRole("contentinfo")).getByText(/©\s*2031/)).toBeInTheDocument();
  });
});
