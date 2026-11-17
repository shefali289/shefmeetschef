import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import RecipeGrid from "./RecipeGrid";
import type { Recipe } from "@/lib/types";

function recipe(id: string, slug: string, title: string): Recipe {
  return {
    id,
    slug,
    title,
    description: null,
    reel_url: null,
    youtube_url: null,
    cover_image_url: null,
    source: "shef",
    ingredients: [],
    steps: [{ text: "Cook." }],
    base_servings: 2,
    prep_minutes: null,
    cook_minutes: null,
    cuisine: "indian",
    diet_tags: [],
    allergens: [],
    categories: [],
    status: "live",
    published_at: null,
  };
}

describe("RecipeGrid", () => {
  it("renders one list item and card link per recipe", () => {
    render(
      <RecipeGrid
        recipes={[recipe("1", "masala-chai", "Masala Chai"), recipe("2", "hakka-noodles", "Hakka Noodles")]}
      />,
    );
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByRole("link")).toHaveAttribute("href", "/recipes/masala-chai");
    expect(within(items[1]).getByRole("link")).toHaveAttribute("href", "/recipes/hakka-noodles");
  });

  it("shows the default empty text without role=status", () => {
    const { container } = render(<RecipeGrid recipes={[]} />);
    expect(screen.getByText("No recipes match those filters yet.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("accepts custom emptyText", () => {
    render(<RecipeGrid recipes={[]} emptyText="Shef is still cooking. Check back soon!" />);
    expect(screen.getByText("Shef is still cooking. Check back soon!")).toBeInTheDocument();
    expect(screen.queryByText("No recipes match those filters yet.")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
