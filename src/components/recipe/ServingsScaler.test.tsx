import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import ServingsScaler from "./ServingsScaler";
import type { Ingredient } from "@/lib/types";

const ingredients: Ingredient[] = [
  { qty: 2, unit: "tsp", item: "sugar" },
  { qty: 400, unit: "g", item: "paneer", note: "cubed" },
  { qty: null, unit: null, item: "salt", note: "to taste" },
];

function setup(base = 4) {
  render(<ServingsScaler baseServings={base} ingredients={ingredients} />);
  const slider = screen.getByRole("slider", { name: /servings/i });
  const items = () => within(screen.getByRole("list")).getAllByRole("listitem");
  return { slider, items };
}

describe("ServingsScaler", () => {
  it("slider ranges 1 to 12 and starts at base servings", () => {
    const { slider, items } = setup(4);
    expect(slider).toHaveAttribute("type", "range");
    expect(slider).toHaveAttribute("min", "1");
    expect(slider).toHaveAttribute("max", "12");
    expect(slider).toHaveValue("4");
    expect(items()).toHaveLength(3);
    expect(items()[0]).toHaveTextContent(/2 tsp sugar/);
    expect(items()[1]).toHaveTextContent(/400 g paneer/);
    expect(items()[1]).toHaveTextContent(/cubed/);
  });

  it("changing servings rescales ingredient quantities", () => {
    const { slider, items } = setup(4);
    fireEvent.change(slider, { target: { value: "2" } });
    expect(items()[0]).toHaveTextContent(/1 tsp sugar/);
    expect(items()[1]).toHaveTextContent(/200 g paneer/);
    fireEvent.change(slider, { target: { value: "3" } });
    expect(items()[0]).toHaveTextContent(/1 1\/2 tsp sugar/);
    expect(items()[1]).toHaveTextContent(/300 g paneer/);
    // null qty stays as-is
    expect(items()[2]).toHaveTextContent(/salt/);
    expect(items()[2]).toHaveTextContent(/to taste/);
  });

  it("slider has accessible label and value text", () => {
    const { slider } = setup(4);
    expect(screen.getByLabelText(/^servings$/i)).toBe(slider);
    expect(slider).toHaveAttribute("aria-valuetext", "4 servings");
    fireEvent.change(slider, { target: { value: "1" } });
    expect(slider).toHaveAttribute("aria-valuetext", "1 serving");
  });

  it("keyboard arrows change servings", () => {
    // jsdom does not move a range input on arrow keys, so simulate the resulting change
    const { slider, items } = setup(4);
    slider.focus();
    expect(slider).toHaveFocus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.change(slider, { target: { value: "5" } });
    expect(slider).toHaveAttribute("aria-valuetext", "5 servings");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.change(slider, { target: { value: "4" } });
    expect(slider).toHaveAttribute("aria-valuetext", "4 servings");
    expect(items()[0]).toHaveTextContent(/2 tsp sugar/);
  });
});
