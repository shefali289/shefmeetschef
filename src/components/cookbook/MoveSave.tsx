"use client";
import { useActionState, useId } from "react";
import { moveSave, type CookbookActionState } from "@/app/cookbook/actions";
import { useAnnounceOnSuccess } from "./CookbookAnnouncer";
import SubmitButton from "./SubmitButton";
import { errorText, field, secondaryButton } from "./styles";

export interface MoveSaveProps {
  saveId: string;
  recipeTitle: string;
  folderId: string | null;
  folders: { id: string; name: string }[];
}

/** Moves one save into a folder, or back to Unfiled. */
export default function MoveSave({ saveId, recipeTitle, folderId, folders }: MoveSaveProps) {
  const [state, formAction, pending] = useActionState<CookbookActionState, FormData>(moveSave, {});
  const selectId = useId();
  useAnnounceOnSuccess(state, "Moved");
  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="save_id" value={saveId} />
      <label htmlFor={selectId} className="sr-only">
        Move {recipeTitle} to a folder
      </label>
      <div className="flex gap-2">
        <select id={selectId} name="folder_id" defaultValue={folderId ?? ""} className={`${field} py-1 text-sm`}>
          <option value="">Unfiled</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <SubmitButton pending={pending} className={`${secondaryButton} px-4 text-sm`}>
          Move
        </SubmitButton>
      </div>
      {state.error && (
        <p role="alert" className={`${errorText} text-sm`}>
          {state.error}
        </p>
      )}
    </form>
  );
}
