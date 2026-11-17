import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import StepList from "./StepList";

describe("StepList", () => {
  it("renders steps as an ordered list under heading Steps", () => {
    render(<StepList steps={[{ text: "Boil water." }, { text: "Add tea." }, { text: "Strain." }]} />);
    const heading = screen.getByRole("heading", { name: "Steps" });
    expect(heading).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Boil water."),
      expect.stringContaining("Add tea."),
      expect.stringContaining("Strain."),
    ]);
    // the section is labelled by its heading
    expect(screen.getByRole("region", { name: "Steps" })).toContainElement(list);
  });
});
