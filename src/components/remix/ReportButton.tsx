"use client";
import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { reportRemix } from "@/app/remixes/report-actions";
import SubmitButton from "@/components/cookbook/SubmitButton";
import { errorText, field, primaryButton, secondaryButton } from "@/components/cookbook/styles";
import type { ReportState } from "@/lib/remix/types";

export interface ReportButtonProps {
  remixId: string;
  authorName: string;
  signedIn: boolean;
  /** The viewer's own remix: nothing is shown. */
  own: boolean;
  /** Where sign-in links and the action send the visitor back to. */
  returnTo: string;
}

const quiet = `${secondaryButton} text-sm`;

/** Report an approved remix: asks inline for an optional reason before posting. No browser dialog. */
export default function ReportButton({ remixId, authorName, signedIn, own, returnTo }: ReportButtonProps) {
  const [state, formAction, pending] = useActionState<ReportState, FormData>(reportRemix, {});
  const [asking, setAsking] = useState(false);
  const reasonId = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const reportRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  /** Set by Cancel so focus goes back to Report when the form closes. */
  const returnFocus = useRef(false);

  useEffect(() => {
    if (asking) reasonRef.current?.focus();
    else if (returnFocus.current) reportRef.current?.focus();
    returnFocus.current = false;
  }, [asking]);

  // The form goes away once reported: keep focus on the thanks message, not lost with the form.
  const done = state.ok === true;
  useEffect(() => {
    if (done) statusRef.current?.focus();
  }, [done]);

  if (own) return null;

  if (!signedIn) {
    return (
      <Link
        href={`/sign-in?next=${encodeURIComponent(returnTo)}`}
        aria-label={`Sign in to report ${authorName}'s remix`}
        className={quiet}
      >
        Sign in to report
      </Link>
    );
  }

  return (
    <div className="space-y-2">
      {done ? null : asking ? (
        <form action={formAction} className="space-y-2 rounded-2xl bg-blush-light p-3">
          <input type="hidden" name="remix_id" value={remixId} />
          <input type="hidden" name="return_to" value={returnTo} />
          <label htmlFor={reasonId} className="block font-semibold text-cocoa">
            Reason (optional)
          </label>
          <textarea ref={reasonRef} id={reasonId} name="reason" maxLength={300} rows={2} className={field} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pending={pending} className={primaryButton}>
              {pending ? "Sending…" : "Send report"}
            </SubmitButton>
            <button
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
        <button
          ref={reportRef}
          type="button"
          onClick={() => setAsking(true)}
          aria-label={`Report ${authorName}'s remix`}
          className={quiet}
        >
          Report
        </button>
      )}
      <p ref={statusRef} tabIndex={-1} role="status" className="font-semibold text-herb focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper">
        {done ? (state.message ?? "Reported, thanks.") : ""}
      </p>
      {state.error && !done && (
        <p role="alert" className={errorText}>
          {state.error}
        </p>
      )}
    </div>
  );
}
