import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import FolderChips from "./FolderChips";

/*
 * Contract: <FolderChips folders selected /> (server-safe, no actions). One link per chip:
 * "All saves" -> /cookbook, each folder -> /cookbook?folder=<id>, in the order given.
 * The selected chip is marked pressed. The plan says aria-pressed; aria-current="page"/"true" is
 * the valid ARIA for links, so either is accepted. Exactly one chip is selected.
 */

const folders = [
  { id: "f0000000-0000-4000-8000-000000000002", name: "Breakfast" },
  { id: "f0000000-0000-4000-8000-000000000001", name: "Desserts & sweets" },
];

/** Links mark the selected chip with aria-current (aria-pressed is for buttons, not links). */
function isSelected(el: HTMLElement): boolean {
  const current = el.getAttribute("aria-current");
  return current === "page" || current === "true";
}

describe("FolderChips", () => {
  it("All saves is selected by default", () => {
    render(<FolderChips folders={folders} selected={null} />);
    const all = screen.getByRole("link", { name: /all saves/i });
    expect(all).toHaveAttribute("href", "/cookbook");
    expect(isSelected(all)).toBe(true);
    for (const f of folders) expect(isSelected(screen.getByRole("link", { name: f.name }))).toBe(false);
  });

  it("chips are aria-current links with shareable ?folder= URLs", () => {
    render(<FolderChips folders={folders} selected={folders[1].id} />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent?.trim())).toEqual(
      expect.arrayContaining(["Breakfast", "Desserts & sweets"]),
    );
    for (const f of folders) {
      const link = screen.getByRole("link", { name: f.name });
      expect(link).toHaveAttribute("href", `/cookbook?folder=${encodeURIComponent(f.id)}`);
    }
    expect(isSelected(screen.getByRole("link", { name: "Desserts & sweets" }))).toBe(true);
    expect(isSelected(screen.getByRole("link", { name: /all saves/i }))).toBe(false);
    expect(links.filter(isSelected)).toHaveLength(1);
    for (const l of links) expect(l).not.toHaveAttribute("aria-pressed");
    // Tap targets.
    for (const l of links) expect(l.className).toMatch(/(^|\s)(min-h|h)-(1[1-9]|[2-9]\d)(\s|$)/);
  });

  it("an unknown selected id falls back to All saves", () => {
    render(<FolderChips folders={folders} selected="f0000000-0000-4000-8000-0000000000ff" />);
    expect(isSelected(screen.getByRole("link", { name: /all saves/i }))).toBe(true);
  });

  it("folder names render as text, not HTML", () => {
    const { container } = render(
      <FolderChips folders={[{ id: "f0000000-0000-4000-8000-000000000003", name: "<img src=x onerror=alert(1)>" }]} selected={null} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: "<img src=x onerror=alert(1)>" })).toBeInTheDocument();
  });
});
