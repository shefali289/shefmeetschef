import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AllergenBox from "./AllergenBox";

const REMINDER = "Always check labels if you have an allergy.";

describe("AllergenBox", () => {
  it("lists allergens", () => {
    render(<AllergenBox allergens={["tree-nuts", "milk", "crustacea"]} />);
    expect(screen.getByRole("heading", { name: /contains/i })).toBeInTheDocument();
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.trim())).toEqual(["Tree nuts", "Milk", "Crustacea"]);
  });

  it("always shows 'check labels if you have an allergy'", () => {
    const { unmount } = render(<AllergenBox allergens={["peanut"]} />);
    expect(screen.getByText(REMINDER)).toBeInTheDocument();
    unmount();
    render(<AllergenBox allergens={[]} />);
    expect(screen.getByText(REMINDER)).toBeInTheDocument();
  });

  it("hidden when no allergens", () => {
    render(<AllergenBox allergens={[]} />);
    // the "Contains" box and list are hidden; only the reminder line remains
    expect(screen.queryByRole("heading", { name: /contains/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText(REMINDER)).toBeInTheDocument();
  });
});
