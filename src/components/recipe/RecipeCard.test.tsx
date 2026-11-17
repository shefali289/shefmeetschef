import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import RecipeCard from "./RecipeCard";
import type { Recipe } from "@/lib/types";

const recipe: Recipe = {
  id: "r1",
  slug: "air-fryer-chana",
  title: "Crispy Air Fryer Chana",
  description: "Crunchy chickpea snack.",
  reel_url: null,
  youtube_url: null,
  cover_image_url: "https://example.supabase.co/storage/v1/object/public/recipe-images/chana.jpg",
  source: "shef",
  ingredients: [{ qty: 400, unit: "g", item: "chickpeas" }],
  steps: [{ text: "Air fry." }],
  base_servings: 2,
  prep_minutes: 5,
  cook_minutes: 15,
  cuisine: "indian",
  diet_tags: ["vegan", "gluten-free"],
  allergens: [],
  categories: ["healthy", "air-fryer"],
  status: "live",
  published_at: "2026-01-01T00:00:00Z",
};

describe("RecipeCard", () => {
  it("title uses script font class", () => {
    render(<RecipeCard recipe={recipe} />);
    const title = screen.getByRole("heading", { name: recipe.title });
    expect(title.className).toContain("font-script");
  });

  it("image is decorative (empty alt) because the title already names the card", () => {
    const { container } = render(<RecipeCard recipe={recipe} />);
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(1);
    expect(imgs[0]).toHaveAttribute("alt", "");
    expect(imgs[0]).toHaveAttribute("src", recipe.cover_image_url);
    // Decorative image is not exposed as an image.
    expect(screen.queryByRole("img", { name: /crispy air fryer chana/i })).toBeNull();
  });

  it("link names the recipe title exactly once", () => {
    for (const r of [recipe, { ...recipe, cover_image_url: null }]) {
      const { unmount } = render(<RecipeCard recipe={r} />);
      const link = screen.getByRole("link", {
        name: (name) => name.split(r.title).length - 1 === 1,
      });
      expect(link).toHaveAttribute("href", "/recipes/air-fryer-chana");
      unmount();
    }
  });

  it("placeholder letter does not use the script font; the title still does", () => {
    const { container } = render(<RecipeCard recipe={{ ...recipe, cover_image_url: null }} />);
    // No img with missing/non-empty alt for the placeholder.
    for (const img of container.querySelectorAll("img")) {
      expect(img).toHaveAttribute("alt", "");
    }
    const title = screen.getByRole("heading", { name: recipe.title });
    expect(title.className).toContain("font-script");
    // Script font for recipe titles only.
    const scripted = [...container.querySelectorAll('[class*="font-script"]')];
    expect(scripted).toEqual([title]);
  });

  it("links to /recipes/[slug]", () => {
    render(<RecipeCard recipe={recipe} />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/recipes/air-fryer-chana");
    }
    // The link has an accessible name that includes the title.
    expect(screen.getAllByRole("link", { name: /crispy air fryer chana/i }).length).toBeGreaterThan(0);
  });

  it("shows diet tags", () => {
    render(<RecipeCard recipe={recipe} />);
    expect(screen.getByText("Vegan")).toBeInTheDocument();
    expect(screen.getByText("Gluten free")).toBeInTheDocument();
  });

  it("without a cover shows a decorative illustrated placeholder, not a block letter", () => {
    const noCover = { ...recipe, cover_image_url: null };
    const { container } = render(<RecipeCard recipe={noCover} />);
    const link = screen.getByRole("link");
    const placeholder = within(link).getByTestId("recipe-placeholder");
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    // The placeholder is the visual slot before the title, not some tiny icon inside it.
    const heading = screen.getByRole("heading", { name: recipe.title });
    expect(placeholder!.contains(heading)).toBe(false);
    // An illustration (e.g. herb sprig / chef hat SVG), not text.
    expect(placeholder!.querySelector("svg")).not.toBeNull();
    // No element anywhere whose whole text is the title's first letter.
    const letter = recipe.title.charAt(0);
    const blockLetters = [...container.querySelectorAll("*")].filter(
      (el) => (el.textContent ?? "").trim() === letter,
    );
    expect(blockLetters).toEqual([]);
    expect((placeholder!.textContent ?? "").trim()).toBe("");
  });

  it("long titles wrap instead of overflowing the card", () => {
    const long = { ...recipe, title: "Supercalifragilisticexpialidociousmasalachaiwithcardamom" };
    render(<RecipeCard recipe={long} />);
    const title = screen.getByRole("heading", { name: long.title });
    expect(title.className).toMatch(/(^|\s)(break-words|\[overflow-wrap:anywhere\])(\s|$)/);
  });
});
