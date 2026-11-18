import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * Contract: <SaveButton recipeId slug saved signedIn /> ("use client").
 * Signed in: a form whose submit button is labelled "Save to my cookbook", aria-pressed = saved,
 * posting recipe_id, intent ("save" when not saved, "unsave" when saved) and return_to
 * (/recipes/<slug>) to toggleSave from @/app/cookbook/actions (useActionState).
 * Signed out (or Supabase not set up): a link to /sign-in?next=%2Frecipes%2F<slug>.
 * Errors (e.g. the 30 saves limit) are announced with role="alert". Target at least 44px.
 */

const { toggleSave, defaultToggle } = vi.hoisted(() => {
  const defaultToggle = async (_prev: unknown, fd: FormData) => ({ saved: fd?.get("intent") === "save" });
  return { toggleSave: vi.fn(defaultToggle), defaultToggle };
});
vi.mock("@/app/cookbook/actions", () => ({
  toggleSave,
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
  moveSave: vi.fn(),
}));

import SaveButton from "./SaveButton";

const RECIPE = "11111111-1111-4111-8111-111111111111";
const TARGET_44 = /(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/;
const WIDTH_44 = /(^|\s)(min-w|w|size)-(1[1-9]|[2-9]\d)(\s|$)/;

beforeEach(() => {
  toggleSave.mockReset();
  toggleSave.mockImplementation(defaultToggle);
});

describe("SaveButton", () => {
  it("heart is an aria-pressed button labelled Save to my cookbook", async () => {
    const user = userEvent.setup();
    render(<SaveButton recipeId={RECIPE} slug="paneer-tikka" saved={false} signedIn />);
    const heart = screen.getByRole("button", { name: /save to my cookbook/i });
    expect(heart).toHaveAttribute("aria-pressed", "false");

    await user.click(heart);
    await waitFor(() => expect(toggleSave).toHaveBeenCalledTimes(1));
    const fd = toggleSave.mock.calls[0][1] as FormData;
    expect(fd.get("recipe_id")).toBe(RECIPE);
    expect(fd.get("intent")).toBe("save");
    expect(fd.get("return_to")).toBe("/recipes/paneer-tikka");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save to my cookbook/i })).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("a saved recipe shows pressed and unsaves on click", async () => {
    const user = userEvent.setup();
    render(<SaveButton recipeId={RECIPE} slug="paneer-tikka" saved signedIn />);
    const heart = screen.getByRole("button", { name: /save to my cookbook/i });
    expect(heart).toHaveAttribute("aria-pressed", "true");
    await user.click(heart);
    await waitFor(() => expect(toggleSave).toHaveBeenCalledTimes(1));
    expect((toggleSave.mock.calls[0][1] as FormData).get("intent")).toBe("unsave");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save to my cookbook/i })).toHaveAttribute("aria-pressed", "false"),
    );
  });

  it("the limit message is announced and the heart stays unpressed", async () => {
    toggleSave.mockImplementationOnce(async () => ({ saved: false, error: "You've used 30 of 30 saves" }) as never);
    const user = userEvent.setup();
    render(<SaveButton recipeId={RECIPE} slug="paneer-tikka" saved={false} signedIn />);
    await user.click(screen.getByRole("button", { name: /save to my cookbook/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/30 of 30 saves/);
    expect(screen.getByRole("button", { name: /save to my cookbook/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("signed-out shows a sign-in link with returnTo the recipe", () => {
    render(<SaveButton recipeId={RECIPE} slug="paneer-tikka" saved={false} signedIn={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /save to my cookbook|sign in to save/i });
    expect(link).toHaveAttribute("href", `/sign-in?next=${encodeURIComponent("/recipes/paneer-tikka")}`);
  });

  it("44px target", () => {
    const { unmount } = render(<SaveButton recipeId={RECIPE} slug="paneer-tikka" saved={false} signedIn />);
    const heart = screen.getByRole("button", { name: /save to my cookbook/i });
    expect(heart.className).toMatch(TARGET_44);
    expect(heart.className).toMatch(WIDTH_44);
    unmount();

    render(<SaveButton recipeId={RECIPE} slug="paneer-tikka" saved={false} signedIn={false} />);
    const link = screen.getByRole("link", { name: /save to my cookbook|sign in to save/i });
    expect(link.className).toMatch(TARGET_44);
    expect(link.className).toMatch(WIDTH_44);
  });

  it("the heart icon is decorative", () => {
    const { container } = render(<SaveButton recipeId={RECIPE} slug="paneer-tikka" saved={false} signedIn />);
    expect(screen.getByRole("button", { name: /save to my cookbook/i })).toBeInTheDocument();
    for (const svg of container.querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
