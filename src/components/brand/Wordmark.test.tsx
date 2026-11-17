import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Wordmark from "./Wordmark";

describe("Wordmark", () => {
  it("renders 'shefmeetschef' linking home", () => {
    render(<Wordmark />);
    const link = screen.getByRole("link", { name: /shefmeetschef/i });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveTextContent("shefmeetschef");
  });

  it("keeps the script font (it is the logo)", () => {
    render(<Wordmark />);
    expect(screen.getByRole("link", { name: /shefmeetschef/i }).className).toContain("font-script");
  });
});
