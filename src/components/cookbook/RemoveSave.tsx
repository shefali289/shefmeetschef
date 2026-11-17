"use client";
import { useActionState } from "react";
import { removeSave, type CookbookActionState } from "@/app/cookbook/actions";
import { useAnnounceOnSuccess } from "./CookbookAnnouncer";
import SubmitButton from "./SubmitButton";
import { errorText, secondaryButton } from "./styles";

/** Removes a save whose recipe is no longer available, freeing up a slot. */
export default function RemoveSave({ saveId }: { saveId: string }) {
  const [state, formAction, pending] = useActionState<CookbookActionState, FormData>(removeSave, {});
  useAnnounceOnSuccess(state, "Removed");
  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="save_id" value={saveId} />
      <SubmitButton pending={pending} className={`${secondaryButton} text-sm`}>
        Remove<span className="sr-only"> this unavailable recipe</span>
      </SubmitButton>
      {state.error && (
        <p role="alert" className={errorText}>
          {state.error}
        </p>
      )}
    </form>
  );
}
