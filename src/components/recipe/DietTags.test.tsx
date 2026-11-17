import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DietTags from "./DietTags";

describe("DietTags", () => {
  it("renders each tag with its colour class and text label", () => {
    render(<DietTags tags={["vegetarian", "vegan", "halal", "gluten-free"]} />);
    const veg = screen.getByText("Vegetarian");
    const vegan = screen.getByText("Vegan");
    const halal = screen.getByText("Halal");
    const gf = screen.getByText("Gluten free");
    // colour is never the only signal: each tag has a text label, plus a colour class
    expect(veg.className).toMatch(/herb/);
    expect(vegan.className).toMatch(/herb/);
    expect(halal.className).not.toBe("");
    expect(gf.className).not.toBe("");
  });
});
