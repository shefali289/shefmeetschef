"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { announce } from "@/components/cookbook/CookbookAnnouncer";
import SubmitButton from "@/components/cookbook/SubmitButton";
import { errorText, field, primaryButton, secondaryButton } from "@/components/cookbook/styles";
import type { ModerationActionState } from "@/lib/remix/types";

type Action = (prev: ModerationActionState, formData: FormData) => Promise<ModerationActionState>;

/** On success: say it in the page's status region and move focus to a stable heading. */
function useAfterSuccess(state: ModerationActionState, successMessage: string, focusAfterId: string) {
  useEffect(() => {
    if (!state.ok) return;
    announce(successMessage);
    document.getElementById(focusAfterId)?.focus();
  }, [state, successMessage, focusAfterId]);
}

export interface ModerationButtonProps {
  action: Action;
  /** Hidden fields posted with the button. */
  fields: Record<string, string>;
  /** Visible text, e.g. "Approve". */
  text: string;
  /** Accessible name that tells items apart, e.g. "Approve Priya's remix of Masala Chai". */
  label: string;
  successMessage: string;
  focusAfterId: string;
  primary?: boolean;
}

/** One-press queue action (approve, hide, unban). */
export function ModerationButton({ action, fields, text, label, successMessage, focusAfterId, primary }: ModerationButtonProps) {
  const [state, formAction, pending] = useActionState(action, {});
  useAfterSuccess(state, successMessage, focusAfterId);

  return (
    <form action={formAction} className="space-y-2">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton pending={pending} aria-label={label} className={primary ? primaryButton : secondaryButton}>
        {text}
      </SubmitButton>
      {state.error && (
        <p role="alert" className={errorText}>
          {state.error}
        </p>
      )}
    </form>
  );
}

export interface BanButtonProps {
  action: Action;
  userId: string;
  name: string;
  focusAfterId: string;
}

/** Ban asks inline first ("Yes, ban" / "Cancel"), with an optional reason. No browser dialog. */
export function BanButton({ action, userId, name, focusAfterId }: BanButtonProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const [asking, setAsking] = useState(false);
  const reasonId = useId();
  const banRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  /** Set by Cancel so focus goes back to Ban when the confirmation closes. */
  const returnFocus = useRef(false);
  useAfterSuccess(state, `${name} is banned`, focusAfterId);

  useEffect(() => {
    if (asking) cancelRef.current?.focus();
    else if (returnFocus.current) banRef.current?.focus();
    returnFocus.current = false;
  }, [asking]);

  return (
    <div className="space-y-2">
      {asking ? (
        <form action={formAction} className="space-y-2 rounded-2xl bg-blush-light p-3">
          <input type="hidden" name="user_id" value={userId} />
          <input type="hidden" name="confirm" value="yes" />
          <p className="font-semibold text-cocoa">
            Ban {name}? Their remixes are hidden and their likes removed. They can&apos;t post, like or report.
          </p>
          <label htmlFor={reasonId} className="block font-semibold text-cocoa">
            Reason (optional)
          </label>
          <textarea id={reasonId} name="reason" maxLength={500} rows={2} className={field} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pending={pending} className={primaryButton}>
              {pending ? "Banning…" : `Yes, ban ${name}`}
            </SubmitButton>
            <button
              ref={cancelRef}
              type="button"
              onClick={() => {
                returnFocus.current = true;
                setAsking(false);
              }}
              className={secondaryButton}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button ref={banRef} type="button" onClick={() => setAsking(true)} className={secondaryButton}>
          Ban {name}
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
