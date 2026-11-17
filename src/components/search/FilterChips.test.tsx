import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FilterChips from "./FilterChips";
import type { Filters } from "@/lib/filters";
import { CATEGORIES, CUISINES, DIET_TAGS } from "@/lib/types";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: nav.push,
    replace: nav.replace,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  // No usePathname: basePath is required, so the component must not depend on the current path.
}));

const empty: Filters = { q: "", cuisine: [], category: [], diet: [] };

/** The URL the component navigated to (push or replace both accepted). */
function lastUrl(): URL {
  const calls = [...nav.push.mock.calls, ...nav.replace.mock.calls];
  expect(calls.length).toBeGreaterThan(0);
  return new URL(String(calls[calls.length - 1][0]), "http://localhost");
}

beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
});

const BASE = "/recipes";

describe("FilterChips", () => {
  it("groups have accessible names", () => {
    render(<FilterChips filters={empty} basePath={BASE} />);
    const cuisine = screen.getByRole("group", { name: "Cuisine" });
    const category = screen.getByRole("group", { name: "Category" });
    const diet = screen.getByRole("group", { name: "Diet" });
    // one chip per allow-listed value, in the right group
    expect(within(cuisine).getAllByRole("button")).toHaveLength(CUISINES.length);
    expect(within(category).getAllByRole("button")).toHaveLength(CATEGORIES.length);
    expect(within(diet).getAllByRole("button")).toHaveLength(DIET_TAGS.length);
    expect(within(cuisine).getByRole("button", { name: /^indian$/i })).toBeInTheDocument();
    expect(within(category).getByRole("button", { name: /^air[ -]fryer$/i })).toBeInTheDocument();
    expect(within(diet).getByRole("button", { name: /^vegan$/i })).toBeInTheDocument();
  });

  it("chips are toggle buttons with aria-pressed", () => {
    render(<FilterChips filters={{ ...empty, cuisine: ["indian"], diet: ["vegan"] }} basePath={BASE} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(CUISINES.length + CATEGORIES.length + DIET_TAGS.length);
    for (const b of buttons) {
      expect(b.tagName).toBe("BUTTON");
      expect(b).toHaveAttribute("type", "button");
      expect(["true", "false"]).toContain(b.getAttribute("aria-pressed"));
    }
    expect(screen.getByRole("button", { name: /^indian$/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^vegan$/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^italian$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /^halal$/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("chips meet 44px min tap target class", () => {
    render(<FilterChips filters={empty} basePath={BASE} />);
    for (const b of screen.getAllByRole("button")) {
      expect(b.className).toContain("min-h-11");
    }
  });

  it("toggling a chip updates the URL query", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <FilterChips filters={{ ...empty, q: "chai", diet: ["vegan"] }} basePath={BASE} />,
    );

    // Turn Indian on: keeps q and existing diet.
    await user.click(screen.getByRole("button", { name: /^indian$/i }));
    let url = lastUrl();
    expect(url.pathname).toBe("/recipes");
    expect(url.searchParams.get("q")).toBe("chai");
    expect(url.searchParams.get("cuisine")).toBe("indian");
    expect(url.searchParams.get("diet")).toBe("vegan");

    // Turn Vegan off: key disappears, no empty "diet=".
    rerender(<FilterChips filters={{ ...empty, q: "chai", cuisine: ["indian"], diet: ["vegan"] }} basePath={BASE} />);
    await user.click(screen.getByRole("button", { name: /^vegan$/i }));
    url = lastUrl();
    expect(url.searchParams.has("diet")).toBe(false);
    expect(url.searchParams.get("cuisine")).toBe("indian");
    expect(url.searchParams.get("q")).toBe("chai");
  });

  it("toggling navigates to basePath and keyboard works", async () => {
    const user = userEvent.setup();
    render(<FilterChips filters={empty} basePath="/recipes" />);
    const halal = screen.getByRole("button", { name: /^halal$/i });
    halal.focus();
    await user.keyboard("{Enter}");
    const url = lastUrl();
    expect(url.pathname).toBe("/recipes");
    expect(url.searchParams.get("diet")).toBe("halal");
  });

  it("basePath is a required prop (type-level)", () => {
    // Never executed; checked by `tsc`. Fails typecheck while basePath is optional.
    const typeCheckOnly = () => (
      // @ts-expect-error basePath is required
      <FilterChips filters={empty} />
    );
    expect(typeof typeCheckOnly).toBe("function");
  });
});
