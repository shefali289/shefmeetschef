import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Hero from "./Hero";

describe("Hero", () => {
  it("shows 'Hi, I'm Shef' with avatar placeholder alt text", () => {
    render(<Hero />);
    expect(screen.getByRole("heading", { name: /Hi, I['’]m Shef/ })).toBeInTheDocument();
    // Avatar placeholder (real illustration comes later) must still be an image with a text alternative.
    const avatar = screen.getByRole("img", { name: /shef/i });
    expect(avatar).toBeInTheDocument();
    const name = avatar.getAttribute("alt") ?? avatar.getAttribute("aria-label") ?? "";
    expect(name.trim().length).toBeGreaterThan(0);
  });

  it("shows tagline 'Raw plates, honest bites & foodie experiments'", () => {
    render(<Hero />);
    expect(screen.getByText("Raw plates, honest bites & foodie experiments")).toBeInTheDocument();
  });

  it("Instagram link warns it opens in a new tab", () => {
    render(<Hero />);
    const link = screen.getByRole("link", { name: /follow @shefmeetschef/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("instagram.com/shefmeetschef"));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
    expect(link).toHaveAccessibleName(/\(opens in new tab\)/);
    const hint = within(link).getByText("(opens in new tab)");
    expect(hint.className).toContain("sr-only");
  });
});
