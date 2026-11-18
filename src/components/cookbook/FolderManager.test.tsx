import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * Contract: <FolderManager folders /> ("use client"), forms posting to createFolder,
 * renameFolder and deleteFolder from @/app/cookbook/actions (useActionState).
 * - Create: input labelled "Folder name" (name="name", required, maxLength 80) + "Create folder".
 * - Rename, per folder: input labelled "Rename <name>" (name="name", maxLength 80, hidden
 *   folder_id) + a "Rename" submit button.
 * - Delete, per folder: button "Delete <name>" first shows a confirmation saying the saves are kept,
 *   with "Yes, delete" (posts folder_id) and "Cancel". Nothing is deleted before confirming.
 * - Action errors are shown with role="alert".
 */

const { createFolder, renameFolder, deleteFolder } = vi.hoisted(() => ({
  createFolder: vi.fn(async () => ({ ok: true })),
  renameFolder: vi.fn(async () => ({ ok: true })),
  deleteFolder: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/cookbook/actions", () => ({
  toggleSave: vi.fn(),
  createFolder,
  renameFolder,
  deleteFolder,
  moveSave: vi.fn(),
}));

import FolderManager from "./FolderManager";

const folders = [
  { id: "f0000000-0000-4000-8000-000000000002", name: "Breakfast" },
  { id: "f0000000-0000-4000-8000-000000000001", name: "Desserts" },
];

function fdOf(mock: { mock: { calls: unknown[][] } }, i = 0): FormData {
  return mock.mock.calls[i][1] as FormData;
}

beforeEach(() => {
  createFolder.mockClear();
  renameFolder.mockClear();
  deleteFolder.mockClear();
});

describe("FolderManager", () => {
  it("create, rename and delete forms are labelled", async () => {
    const user = userEvent.setup();
    render(<FolderManager folders={folders} />);

    const create = screen.getByLabelText(/^(new )?folder name$/i);
    expect(create).toHaveAttribute("maxLength", "80");
    expect(create).toBeRequired();
    await user.type(create, "Curries");
    await user.click(screen.getByRole("button", { name: /create folder/i }));
    await waitFor(() => expect(createFolder).toHaveBeenCalledTimes(1));
    expect(fdOf(createFolder).get("name")).toBe("Curries");

    const rename = screen.getByLabelText(/rename desserts/i);
    expect(rename).toHaveAttribute("maxLength", "80");
    await user.clear(rename);
    await user.type(rename, "Puddings");
    const renameForm = rename.closest("form")!;
    await user.click(within(renameForm).getByRole("button", { name: /rename/i }));
    await waitFor(() => expect(renameFolder).toHaveBeenCalledTimes(1));
    expect(fdOf(renameFolder).get("folder_id")).toBe(folders[1].id);
    expect(fdOf(renameFolder).get("name")).toBe("Puddings");

    for (const f of folders) expect(screen.getByRole("button", { name: `Delete ${f.name}` })).toBeInTheDocument();
  });

  it("delete asks for confirmation and says saves are kept", async () => {
    const user = userEvent.setup();
    render(<FolderManager folders={folders} />);

    await user.click(screen.getByRole("button", { name: "Delete Desserts" }));
    expect(deleteFolder).not.toHaveBeenCalled();
    expect(screen.getByText(/saves are kept|keep(s)? (its|the|your) saves/i)).toBeInTheDocument();

    // Cancel leaves the folder alone.
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(deleteFolder).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete Desserts" }));
    await user.click(screen.getByRole("button", { name: /yes, delete/i }));
    await waitFor(() => expect(deleteFolder).toHaveBeenCalledTimes(1));
    expect(fdOf(deleteFolder).get("folder_id")).toBe(folders[1].id);
  });

  it("errors are announced", async () => {
    createFolder.mockImplementationOnce(async () => ({ error: "Folder names can be up to 80 characters" }) as never);
    const user = userEvent.setup();
    render(<FolderManager folders={[]} />);
    await user.type(screen.getByLabelText(/^(new )?folder name$/i), "x");
    await user.click(screen.getByRole("button", { name: /create folder/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/80 characters/);
  });

  it("buttons are 44px tap targets", () => {
    render(<FolderManager folders={folders} />);
    for (const b of screen.getAllByRole("button")) {
      expect(b.className, b.textContent ?? "").toMatch(/(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/);
    }
  });
});
