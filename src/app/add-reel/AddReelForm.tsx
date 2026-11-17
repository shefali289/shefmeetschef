"use client";
import { useActionState, useId, useState } from "react";
import { FREE_LIMITS, limitReachedText, reelsLeftText } from "@/lib/limits";
import { CAPTION_MAX_LENGTH, type AddReelFormState } from "@/lib/outside/types";

export interface AddReelFormProps {
  /** Reels left this month. */
  remaining: number;
  limit?: number;
  action: (prev: AddReelFormState, formData: FormData) => Promise<AddReelFormState>;
}

const field =
  "block w-full rounded-2xl border-2 border-cocoa/20 bg-white px-4 py-3 text-cocoa placeholder:text-cocoa-soft focus-visible:border-copper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper aria-invalid:border-copper";

const notice = "rounded-2xl bg-white p-4 font-semibold ring-1 ring-cocoa/10";

/** Paste a reel link and its caption; Shef turns it into a private recipe card. */
export default function AddReelForm({ remaining, limit = FREE_LIMITS.outside_reel, action }: AddReelFormProps) {
  const [state, formAction, pending] = useActionState(action, null);
  // Controlled, so a pasted caption is kept when the server sends back an error.
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const urlId = useId();
  const captionId = useId();
  const urlError = state?.status === "invalid" ? state.errors.url : undefined;
  const captionError = state?.status === "invalid" ? state.errors.caption : undefined;
  const left = state?.status === "no-recipe" ? state.remaining : state?.status === "limit" ? 0 : remaining;

  if (left <= 0) {
    return (
      <p role="status" className={notice}>
        {state?.status === "limit"
          ? state.message
          : limitReachedText("outside_reel", limit)}
      </p>
    );
  }

  const message =
    state?.status === "no-recipe" || state?.status === "error" || state?.status === "not-configured"
      ? state.message
      : null;

  return (
    <form action={formAction} className="space-y-5" aria-busy={pending}>
      <p className="font-semibold text-cocoa-soft">{reelsLeftText(left, limit)}</p>

      <div className="space-y-2">
        <label htmlFor={urlId} className="block font-bold">
          Instagram reel link
        </label>
        <input
          id={urlId}
          name="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          type="url"
          required
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.instagram.com/reel/..."
          aria-invalid={urlError ? true : undefined}
          aria-describedby={urlError ? `${urlId}-error` : undefined}
          className={`${field} min-h-11`}
        />
        {urlError && (
          <p id={`${urlId}-error`} role="alert" className="font-semibold text-copper-ink">
            {urlError}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor={captionId} className="block font-bold">
          Caption
        </label>
        <p id={`${captionId}-hint`} className="text-sm text-cocoa-soft">
          Copy the reel&rsquo;s caption from Instagram and paste it here. We only keep the recipe and
          the link, never the video.
        </p>
        <textarea
          id={captionId}
          name="caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          required
          rows={8}
          maxLength={CAPTION_MAX_LENGTH}
          aria-invalid={captionError ? true : undefined}
          aria-describedby={`${captionId}-hint${captionError ? ` ${captionId}-error` : ""}`}
          className={field}
        />
        {captionError && (
          <p id={`${captionId}-error`} role="alert" className="font-semibold text-copper-ink">
            {captionError}
          </p>
        )}
      </div>

      {message && (
        <p role="alert" className={`${notice} border-2 border-copper`}>
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="press inline-flex min-h-11 items-center justify-center rounded-full bg-copper px-6 py-2 font-bold text-white shadow-soft hover:bg-copper-dark focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cocoa disabled:opacity-70"
      >
        {pending ? "Making your recipe card…" : "Make my recipe card"}
      </button>
    </form>
  );
}
