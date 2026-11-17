import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SkipLink from "./SkipLink";

describe("SkipLink", () => {
  it("renders a 'Skip to content' link to #main", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(link).toHaveAttribute("href", "#main");
  });

  it("is the first thing keyboard users reach", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SkipLink />
        <a href="#later">Later link</a>
      </>,
    );
    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
  });
});
