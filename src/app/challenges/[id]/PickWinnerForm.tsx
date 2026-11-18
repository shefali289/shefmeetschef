"use client";

import { useActionState } from "react";
import type { PickWinnerState } from "@/lib/challenges/types";

export interface PickWinnerFormProps {
  challengeId: string;
  remixId: string;
  authorName: string;
  /** 1-based place in the list, so two "A home cook" entries still get different names. */
  position: number;
  total: number;
  action: (prev: PickWinnerState, formData: FormData) => Promise<PickWinnerState>;
}

/** Admin only (the page decides, the action checks again): picks this entry as the winner. */
export default function PickWinnerForm({ challengeId, remixId, authorName, position, total, action }: PickWinnerFormProps) {
  const label = `Pick ${authorName}\u2019s remix as winner`;
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="challenge_id" value={challengeId} />
      <input type="hidden" name="remix_id" value={remixId} />
      <button
        type="submit"
        disabled={pending}
        // Starts with the visible text (label in name), then says which entry it is.
        aria-label={`${label} (entry ${position} of ${total})`}
        className="press inline-flex min-h-11 w-full items-center justify-center rounded-full border-2 border-herb bg-white px-5 py-2 font-bold text-herb hover:bg-herb-light focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-herb disabled:opacity-70"
      >
        {label}
      </button>
      {state?.error && (
        <p role="alert" className="mt-2 font-semibold text-copper-ink">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="mt-2 font-semibold text-herb">
          Winner picked.
        </p>
      )}
    </form>
  );
}
