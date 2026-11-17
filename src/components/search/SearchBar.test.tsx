import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchBar from "./SearchBar";
import type { Filters } from "@/lib/filters";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: nav.push,
    replace: nav.replace,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const empty: Filters = { q: "", cuisine: [], category: [], diet: [] };

function lastUrl(): URL {
  const calls = [...nav.push.mock.calls, ...nav.replace.mock.calls];
  expect(calls.length).toBeGreaterThan(0);
  return new URL(String(calls[calls.length - 1][0]), "http://localhost");
}

beforeEach(() => {
  nav.push.mockReset();
  nav.replace.mockReset();
});

describe("SearchBar", () => {
  it("has a labelled search input", () => {
    render(<SearchBar filters={{ ...empty, q: "chai" }} />);
    const input = screen.getByRole("searchbox", { name: "Search recipes" });
    expect(input).toHaveAttribute("type", "search");
    expect(input).toHaveAttribute("name", "q");
    expect(input).toHaveAttribute("maxlength", "100");
    expect(input).toHaveValue("chai");
    // Works without JS too: a real form pointing at /recipes.
    const form = input.closest("form");
    expect(form).not.toBeNull();
    expect(form).toHaveAttribute("action", "/recipes");
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });

  it("input border is solid brand orange, not translucent", () => {
    render(<SearchBar filters={empty} />);
    const input = screen.getByRole("searchbox", { name: "Search recipes" });
    // A translucent orange border fails the 3:1 non-text contrast rule (WCAG 1.4.11).
    expect(input.className).toContain("border-shef-orange");
    expect(input.className).not.toContain("border-shef-orange/");
  });

  it("submitting navigates with q while keeping other filters", async () => {
    const user = userEvent.setup();
    render(
      <SearchBar filters={{ q: "old", cuisine: ["indian"], category: ["drinks"], diet: ["vegan"] }} />,
    );
    const input = screen.getByRole("searchbox", { name: "Search recipes" });
    await user.clear(input);
    await user.type(input, "  Paneer Tikka {Enter}");
    const url = lastUrl();
    expect(url.pathname).toBe("/recipes");
    expect(url.searchParams.get("q")).toBe("Paneer Tikka");
    expect(url.searchParams.get("cuisine")).toBe("indian");
    expect(url.searchParams.get("category")).toBe("drinks");
    expect(url.searchParams.get("diet")).toBe("vegan");
  });

  it("submitting an empty query drops q but keeps filters", async () => {
    const user = userEvent.setup();
    render(<SearchBar filters={{ ...empty, q: "old", diet: ["halal"] }} />);
    const input = screen.getByRole("searchbox", { name: "Search recipes" });
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: /search/i }));
    const url = lastUrl();
    expect(url.pathname).toBe("/recipes");
    expect(url.searchParams.has("q")).toBe(false);
    expect(url.searchParams.get("diet")).toBe("halal");
  });
});
