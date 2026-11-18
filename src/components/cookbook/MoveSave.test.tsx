import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * Contract: <MoveSave saveId recipeTitle folderId folders /> ("use client"): a form with a select
 * (name="folder_id") labelled "Move <recipeTitle> to a folder", options "Unfiled" (value "") then
 * each folder (value = id), the current folder selected, a hidden save_id and a "Move" button,
 * posting to moveSave from @/app/cookbook/actions.
 */

const { moveSave } = vi.hoisted(() => ({ moveSave: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/app/cookbook/actions", () => ({
  toggleSave: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
  moveSave,
}));

import MoveSave from "./MoveSave";

const SAVE = "50000000-0000-4000-8000-000000000001";
const folders = [
  { id: "f0000000-0000-4000-8000-000000000002", name: "Breakfast" },
  { id: "f0000000-0000-4000-8000-000000000001", name: "Desserts" },
];

describe("MoveSave", () => {
  it("select lists Unfiled and the user's folders", () => {
    render(<MoveSave saveId={SAVE} recipeTitle="Paneer Tikka" folderId={null} folders={folders} />);
    const select = screen.getByRole("combobox", { name: /move paneer tikka/i });
    const options = Array.from((select as HTMLSelectElement).options);
    expect(options.map((o) => o.textContent?.trim())).toEqual(["Unfiled", "Breakfast", "Desserts"]);
    expect(options.map((o) => o.value)).toEqual(["", folders[0].id, folders[1].id]);
    expect(select).toHaveValue("");
  });

  it("the current folder is selected", () => {
    render(<MoveSave saveId={SAVE} recipeTitle="Paneer Tikka" folderId={folders[1].id} folders={folders} />);
    expect(screen.getByRole("combobox", { name: /move paneer tikka/i })).toHaveValue(folders[1].id);
  });

  it("moving posts the save id and the chosen folder", async () => {
    const user = userEvent.setup();
    render(<MoveSave saveId={SAVE} recipeTitle="Paneer Tikka" folderId={folders[1].id} folders={folders} />);
    await user.selectOptions(screen.getByRole("combobox", { name: /move paneer tikka/i }), "Unfiled");
    await user.click(screen.getByRole("button", { name: /^move/i }));
    await waitFor(() => expect(moveSave).toHaveBeenCalledTimes(1));
    const fd = (moveSave.mock.calls[0] as unknown[])[1] as FormData;
    expect(fd.get("save_id")).toBe(SAVE);
    expect(fd.get("folder_id")).toBe("");
  });
});
