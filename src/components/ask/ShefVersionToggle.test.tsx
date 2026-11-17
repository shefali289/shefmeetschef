import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ShefVersion } from "@/lib/ask-shef/types";
import ShefVersionToggle from "./ShefVersionToggle";

const ORIGINAL: ShefVersion = {
  ingredients: [{ qty: 200, unit: "g", item: "paneer" }],
  steps: [{ text: "Marinate the paneer." }],
  diet_tags: ["vegetarian"],
};
const VEGAN: ShefVersion = {
  ingredients: [{ qty: 200, unit: "g", item: "firm tofu" }],
  steps: [{ text: "Press and marinate the tofu." }],
  diet_tags: ["vegan"],
};

/** The ingredient row (a <ul> item; steps are in an <ol>), so a step mentioning it cannot match. */
function ingredientRow(item: string): HTMLElement | undefined {
  return screen
    .queryAllByRole("listitem")
    .find((li) => li.parentElement?.tagName === "UL" && li.textContent?.includes(item));
}

describe("ShefVersionToggle", () => {
  it("original is shown by default", () => {
    render(<ShefVersionToggle original={ORIGINAL} version={VEGAN} />);
    expect(ingredientRow("paneer")).toBeInTheDocument();
    expect(screen.getByText("Marinate the paneer.")).toBeInTheDocument();
    expect(screen.queryByText(/firm tofu/)).toBeNull();
    expect(screen.getByRole("button", { name: /shef.s version/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("toggle is an aria-pressed button that swaps ingredients, steps and diet tags", async () => {
    const user = userEvent.setup();
    render(<ShefVersionToggle original={ORIGINAL} version={VEGAN} />);
    const button = screen.getByRole("button", { name: /shef.s version/i });
    expect(button.className).toMatch(/min-h-11|min-h-\[44px\]|h-11|h-12/);

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(ingredientRow("firm tofu")).toBeInTheDocument();
    expect(screen.getByText("Press and marinate the tofu.")).toBeInTheDocument();
    expect(screen.getByText(/vegan/i)).toBeInTheDocument();
    expect(screen.queryByText(/paneer/)).toBeNull();
    expect(screen.queryByText(/vegetarian/i)).toBeNull();

    // keyboard works too
    button.focus();
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(ingredientRow("paneer")).toBeInTheDocument();
    expect(ingredientRow("firm tofu")).toBeUndefined();
    expect(screen.getByText("Marinate the paneer.")).toBeInTheDocument();
  });
});
