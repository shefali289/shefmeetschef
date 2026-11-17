"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { announce } from "./CookbookAnnouncer";
import SubmitButton from "./SubmitButton";
import { errorText, primaryButton, secondaryButton } from "./styles";

type State = { ok?: boolean; error?: string };

export interface ConfirmDeleteProps {
  /** Accessible, visible label of the first button, e.g. "Delete Desserts". */
  label: string;
  /** What happens if they say yes. */
  message: string;
  /** Hidden fields posted with "Yes, delete". */
  fields: Record<string, string>;
  action: (prev: State, formData: FormData) => Promise<State>;
  /** Said in the cookbook status region once the delete succeeds, e.g. "Folder deleted". */
  successMessage: string;
  /** Id of a stable element (e.g. a section heading with tabIndex -1) to focus after the delete. */
  focusAfterId?: string;
}

/** A delete button that asks inline ("Yes, delete" / "Cancel") before posting. No browser dialog. */
export default function ConfirmDelete({ label, message, fields, action, successMessage, focusAfterId }: ConfirmDeleteProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const [asking, setAsking] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes when the confirmation closes: back to Delete, or nowhere (after a delete). */
  const returnFocus = useRef(false);

  useEffect(() => {
    if (asking) cancelRef.current?.focus();
    else if (returnFocus.current) deleteRef.current?.focus();
    returnFocus.current = false;
  }, [asking]);

  // On success: announce it, and move focus somewhere that will still exist once this control
  // disappears with the refreshed page.
  useEffect(() => {
    if (!state.ok) return;
    announce(successMessage);
    if (focusAfterId) document.getElementById(focusAfterId)?.focus();
    setAsking(false);
  }, [state, successMessage, focusAfterId]);

  function cancel() {
    returnFocus.current = true;
    setAsking(false);
  }

  return (
    <div className="space-y-2">
      {asking ? (
        <form action={formAction} className="space-y-2 rounded-2xl bg-blush-light p-3">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <p className="font-semibold text-cocoa">{message}</p>
          <div className="flex flex-wrap gap-2">
            <SubmitButton pending={pending} className={primaryButton}>
              {pending ? "Deleting…" : "Yes, delete"}
            </SubmitButton>
            <button ref={cancelRef} type="button" onClick={cancel} className={secondaryButton}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button ref={deleteRef} type="button" onClick={() => setAsking(true)} className={`${secondaryButton} text-sm`}>
          {label}
        </button>
      )}
      {state.error && (
        <p role="alert" className={errorText}>
          {state.error}
        </p>
      )}
    </div>
  );
}
