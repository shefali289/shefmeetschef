import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AboutShef from "./AboutShef";

describe("AboutShef", () => {
  it("shows About Shef copy", () => {
    render(<AboutShef />);
    expect(screen.getByRole("heading", { name: /about shef/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Very raw, unfiltered homemade food, no fancy plating/),
    ).toBeInTheDocument();
  });
});
