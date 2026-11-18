import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * Contract: <DeleteReel recipeId title /> ("use client"). A "Delete <title>" button first shows an
 * inline confirmation (no browser dialog) that says the reel is not given back this month, with
 * "Yes, delete" (posts recipe_id to deleteReel from @/app/cookbook/reel-actions) and "Cancel".
 * Errors are announced with role="alert". Buttons are 44px targets.
 */

const { deleteReel } = vi.hoisted(() => ({ deleteReel: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/app/cookbook/reel-actions", () => ({ deleteReel }));

import DeleteReel from "./DeleteReel";

const RECIPE = "11111111-1111-4111-8111-111111111111";
const TARGET_44 = /(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/;

beforeEach(() => deleteReel.mockClear());

describe("DeleteReel", () => {
  it("asks inline before deleting and says the reel is not given back", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    render(<DeleteReel recipeId={RECIPE} title="Nani's Dal" />);

    await user.click(screen.getByRole("button", { name: "Delete Nani's Dal" }));
    expect(deleteReel).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/(won[’']t|does not|doesn[’']t) give (you )?(the|a|that) reel back/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(deleteReel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete Nani's Dal" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Nani's Dal" }));
    await user.click(screen.getByRole("button", { name: /yes, delete/i }));
    await waitFor(() => expect(deleteReel).toHaveBeenCalledTimes(1));
    expect(((deleteReel.mock.calls[0] as unknown[])[1] as FormData).get("recipe_id")).toBe(RECIPE);
    confirmSpy.mockRestore();
  });

  it("errors are announced", async () => {
    deleteReel.mockImplementationOnce(async () => ({ error: "We couldn't delete that reel." }) as never);
    const user = userEvent.setup();
    render(<DeleteReel recipeId={RECIPE} title="Nani's Dal" />);
    await user.click(screen.getByRole("button", { name: "Delete Nani's Dal" }));
    await user.click(screen.getByRole("button", { name: /yes, delete/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't delete/);
  });

  it("buttons are 44px tap targets", async () => {
    const user = userEvent.setup();
    render(<DeleteReel recipeId={RECIPE} title="Nani's Dal" />);
    expect(screen.getByRole("button").className).toMatch(TARGET_44);
    await user.click(screen.getByRole("button", { name: "Delete Nani's Dal" }));
    for (const b of screen.getAllByRole("button")) expect(b.className).toMatch(TARGET_44);
  });
});
