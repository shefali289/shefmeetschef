"use client";
import { useActionState, useId } from "react";
import { createFolder, deleteFolder, renameFolder, type CookbookActionState } from "@/app/cookbook/actions";
import { useAnnounceOnSuccess } from "./CookbookAnnouncer";
import ConfirmDelete from "./ConfirmDelete";
import { FOLDERS_HEADING_ID } from "./ids";
import SubmitButton from "./SubmitButton";
import { errorText, field, primaryButton, secondaryButton } from "./styles";

export interface FolderManagerProps {
  folders: { id: string; name: string }[];
}

const NAME_MAX = 80;


function CreateFolderForm() {
  const [state, formAction, pending] = useActionState<CookbookActionState, FormData>(createFolder, {});
  const inputId = useId();
  useAnnounceOnSuccess(state, "Folder created");
  return (
    <form action={formAction} className="space-y-2">
      <label htmlFor={inputId} className="block font-bold">
        Folder name
      </label>
      <div className="flex flex-wrap gap-2">
        <input id={inputId} name="name" required maxLength={NAME_MAX} autoComplete="off" className={`${field} flex-1`} />
        <SubmitButton pending={pending} className={primaryButton}>
          Create folder
        </SubmitButton>
      </div>
      {state.error && (
        <p role="alert" className={errorText}>
          {state.error}
        </p>
      )}
    </form>
  );
}

function FolderRow({ folder }: { folder: { id: string; name: string } }) {
  const [state, formAction, pending] = useActionState<CookbookActionState, FormData>(renameFolder, {});
  const inputId = useId();
  useAnnounceOnSuccess(state, "Renamed");
  return (
    <li className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-cocoa/10">
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="folder_id" value={folder.id} />
        <label htmlFor={inputId} className="sr-only">
          Rename {folder.name}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            name="name"
            required
            maxLength={NAME_MAX}
            defaultValue={folder.name}
            autoComplete="off"
            className={`${field} flex-1`}
          />
          <SubmitButton pending={pending} className={`${secondaryButton} text-sm`}>
            Rename
          </SubmitButton>
        </div>
        {state.error && (
          <p role="alert" className={errorText}>
            {state.error}
          </p>
        )}
      </form>
      <ConfirmDelete
        label={`Delete ${folder.name}`}
        message={`Delete ${folder.name}? Your saves are kept, they just become unfiled.`}
        fields={{ folder_id: folder.id }}
        action={deleteFolder}
        successMessage="Folder deleted"
        focusAfterId={FOLDERS_HEADING_ID}
      />
    </li>
  );
}

/** Create, rename and delete the user's cookbook folders. */
export default function FolderManager({ folders }: FolderManagerProps) {
  return (
    <div className="space-y-4">
      <CreateFolderForm />
      {folders.length > 0 && (
        <ul className="space-y-3">
          {folders.map((f) => (
            <FolderRow key={f.id} folder={f} />
          ))}
        </ul>
      )}
    </div>
  );
}
