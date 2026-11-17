import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AboutShef from "./AboutShef";

vi.mock("next/image", () => import("@/test/next-image-mock"));

describe("AboutShef", () => {
  it("shows About Shef copy", () => {
    render(<AboutShef />);
    expect(screen.getByRole("heading", { name: /about shef/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Very raw, unfiltered homemade food, no fancy plating/),
    ).toBeInTheDocument();
  });

  it("shows a photo of Shef with meaningful alt text", () => {
    render(<AboutShef />);
    const photos = screen
      .getAllByRole("img", { name: /shef/i })
      .filter((img) => /\/brand\/shef-(presenting|thinking)/.test(img.getAttribute("src") ?? ""));
    expect(photos.length).toBeGreaterThan(0);
    for (const img of photos) {
      expect((img.getAttribute("alt") ?? "").trim().length).toBeGreaterThan(3);
    }
  });
});
