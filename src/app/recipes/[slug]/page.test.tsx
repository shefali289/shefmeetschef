import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RecipePage from "./page";

vi.mock("next/image", () => import("@/test/next-image-mock"));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/recipes/masala-chai",
  useSearchParams: () => new URLSearchParams(),
}));

describe("recipe page", () => {
  it("h1 title wraps long words instead of overflowing on mobile", async () => {
    // Runs on sample recipes (no Supabase env vars).
    render(await RecipePage({ params: Promise.resolve({ slug: "masala-chai" }) }));
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toMatch(/(^|\s)(break-words|\[overflow-wrap:anywhere\])(\s|$)/);
  });
});
