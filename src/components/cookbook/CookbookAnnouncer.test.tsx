import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * Review N1/N3: successful cookbook changes are announced to screen readers.
 *
 * Contract: src/components/cookbook/CookbookAnnouncer.tsx ("use client")
 *   default export <CookbookAnnouncer />: ONE persistent role="status" region, mounted once on
 *   /cookbook (outside the folder list and reel cards, so it survives them being removed after a
 *   delete revalidates the page). Empty until something is announced.
 *   The cookbook controls announce through it on success:
 *     ConfirmDelete in FolderManager -> "Folder deleted"
 *     ConfirmDelete in DeleteReel    -> "Reel deleted"
 *     FolderManager rename           -> "Renamed"
 *     MoveSave                       -> "Moved"
 *   Errors still use role="alert" in the control and announce nothing here.
 */

const { deleteReel, actions } = vi.hoisted(() => ({
  deleteReel: vi.fn(async () => ({ ok: true }) as { ok?: boolean; error?: string }),
  actions: {
    toggleSave: vi.fn(),
    createFolder: vi.fn(async () => ({ ok: true })),
    renameFolder: vi.fn(async () => ({ ok: true }) as { ok?: boolean; error?: string }),
    deleteFolder: vi.fn(async () => ({ ok: true }) as { ok?: boolean; error?: string }),
    moveSave: vi.fn(async () => ({ ok: true }) as { ok?: boolean; error?: string }),
    removeSave: vi.fn(async () => ({ ok: true })),
  },
}));
vi.mock("@/app/cookbook/reel-actions", () => ({ deleteReel }));
vi.mock("@/app/cookbook/actions", () => actions);

import CookbookAnnouncer from "./CookbookAnnouncer";
import DeleteReel from "./DeleteReel";
import FolderManager from "./FolderManager";
import MoveSave from "./MoveSave";

const RECIPE = "11111111-1111-4111-8111-111111111111";
const SAVE = "50000000-0000-4000-8000-000000000001";
const folders = [
  { id: "f0000000-0000-4000-8000-000000000002", name: "Breakfast" },
  { id: "f0000000-0000-4000-8000-000000000001", name: "Desserts" },
];

/** Renders the announcer on its own first, so its region is the one we hold on to. */
function announcer(): HTMLElement {
  render(<CookbookAnnouncer />);
  const regions = screen.getAllByRole("status");
  expect(regions).toHaveLength(1);
  expect(regions[0]).toHaveTextContent("");
  return regions[0];
}

beforeEach(() => {
  deleteReel.mockClear();
  for (const fn of Object.values(actions)) fn.mockClear();
});

describe("cookbook announcements", () => {
  it("deleting a reel announces Reel deleted", async () => {
    const region = announcer();
    const user = userEvent.setup();
    const { unmount } = render(<DeleteReel recipeId={RECIPE} title="Nani's Dal" />);
    await user.click(screen.getByRole("button", { name: "Delete Nani's Dal" }));
    await user.click(screen.getByRole("button", { name: /yes, delete/i }));
    await waitFor(() => expect(region).toHaveTextContent("Reel deleted"));
    // the card goes away when the page refreshes; the message stays
    unmount();
    expect(region).toHaveTextContent("Reel deleted");
  });

  it("deleting a folder announces Folder deleted", async () => {
    const region = announcer();
    const user = userEvent.setup();
    const { rerender } = render(<FolderManager folders={folders} />);
    await user.click(screen.getByRole("button", { name: "Delete Desserts" }));
    await user.click(screen.getByRole("button", { name: /yes, delete/i }));
    await waitFor(() => expect(region).toHaveTextContent("Folder deleted"));
    // the folder disappears after revalidation; the message stays
    rerender(<FolderManager folders={[folders[0]]} />);
    expect(region).toHaveTextContent("Folder deleted");
  });

  it("renaming a folder announces Renamed", async () => {
    const region = announcer();
    const user = userEvent.setup();
    render(<FolderManager folders={folders} />);
    const input = screen.getByLabelText(/rename desserts/i);
    await user.clear(input);
    await user.type(input, "Puddings");
    const renameButtons = screen.getAllByRole("button", { name: /^rename$/i });
    await user.click(renameButtons[1]);
    await waitFor(() => expect(actions.renameFolder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(region).toHaveTextContent("Renamed"));
  });

  it("moving a save announces Moved", async () => {
    const region = announcer();
    const user = userEvent.setup();
    render(<MoveSave saveId={SAVE} recipeTitle="Dal" folderId={null} folders={folders} />);
    await user.selectOptions(screen.getByRole("combobox", { name: /move dal/i }), folders[1].id);
    await user.click(screen.getByRole("button", { name: /^move$/i }));
    await waitFor(() => expect(actions.moveSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(region).toHaveTextContent("Moved"));
  });

  it("failures announce nothing in the status region", async () => {
    actions.moveSave.mockImplementationOnce(async () => ({ error: "We couldn't find that save." }));
    const region = announcer();
    const user = userEvent.setup();
    render(<MoveSave saveId={SAVE} recipeTitle="Dal" folderId={null} folders={folders} />);
    await user.click(screen.getByRole("button", { name: /^move$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't find that save/);
    expect(region).not.toHaveTextContent(/moved/i);
  });
});
