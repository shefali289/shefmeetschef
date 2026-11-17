import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFound from "./not-found";

vi.mock("next/image", () => import("@/test/next-image-mock"));

describe("not-found page", () => {
  it("shows a heading", () => {
    render(<NotFound />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect((heading.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("shows the shef-thinking photo with meaningful alt text", () => {
    render(<NotFound />);
    const photo = screen
      .getAllByRole("img", { name: /shef/i })
      .find((img) => (img.getAttribute("src") ?? "").includes("/brand/shef-thinking"));
    expect(photo).toBeDefined();
    expect(photo!.getAttribute("alt") ?? "").toMatch(/shef/i);
  });

  it("links back to /recipes with a 44px target", () => {
    render(<NotFound />);
    const link = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === "/recipes");
    expect(link).toBeDefined();
    expect((link!.textContent ?? "").trim().length).toBeGreaterThan(0);
    expect(link!.className).toContain("min-h-11");
  });
});
