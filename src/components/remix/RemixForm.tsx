"use client";
import { useEffect, useId, useRef, useState } from "react";
import SubmitButton from "@/components/cookbook/SubmitButton";
import { errorText, primaryButton } from "@/components/cookbook/styles";
import { FREE_LIMITS, limitReachedText, remixesLeftText } from "@/lib/limits";
import { CHANGES_MAX_LENGTH, takeRemixPrefill, validateChanges } from "@/lib/remix/changes";
import { checkPhotoFile, isPhotoType, PHOTO_ACCEPT, photoPathFor } from "@/lib/remix/photo";
import { preparePhoto } from "@/lib/remix/prepare-photo";
import { REMIX_NOT_CONFIGURED } from "@/lib/remix/status";
import type { RemixFormState } from "@/lib/remix/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export interface RemixFormProps {
  slug: string;
  /** The signed-in user's id: photos go to remix-photos/<userId>/. */
  userId: string;
  /** Remixes left today. */
  remaining: number;
  limit?: number;
  action: (prev: RemixFormState, formData: FormData) => Promise<RemixFormState>;
}

const UPLOAD_FAILED = "We couldn't upload your photo. Please try again.";

const field =
  "block w-full rounded-2xl border-2 border-cocoa/20 bg-white px-4 py-3 text-cocoa focus-visible:border-copper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper";

/** The message to announce for a result, if it is a problem. */
function problem(result: RemixFormState): string | null {
  if (!result) return null;
  switch (result.status) {
    case "invalid":
      return [result.errors.photo, result.errors.changes].filter(Boolean).join(" ") || null;
    case "not-configured":
    case "not-found":
    case "banned":
    case "error":
      return result.message;
    case "signed-out":
      return "Please sign in again to post your remix.";
    default:
      return null;
  }
}

/**
 * Photo and "what you changed". The photo is resized in the browser and uploaded straight to the
 * user's own remix-photos folder with their session (never overwriting); the server action gets
 * only its path and checks the file again.
 */
export default function RemixForm({ slug, userId, remaining, limit = FREE_LIMITS.remix, action }: RemixFormProps) {
  const photoId = useId();
  const photoHintId = useId();
  const changesId = useId();
  const changesHintId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [changes, setChanges] = useState("");
  const [left, setLeft] = useState(remaining);
  const [result, setResult] = useState<RemixFormState>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const limitRef = useRef<HTMLParagraphElement>(null);
  /** Set when a result replaces the form with the limit box, so focus is not lost with the form. */
  const focusLimit = useRef(false);

  // Shef's version from Ask Shef, read once after mount (sessionStorage is browser-only).
  useEffect(() => {
    const prefill = takeRemixPrefill(slug);
    if (prefill) setChanges(prefill);
  }, [slug]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setLocalError(null);
    setResult(null);
    const file = fileRef.current?.files?.[0];
    const fileError = file ? checkPhotoFile(file) : "Please choose a photo of your remix.";
    if (!file || fileError) return setLocalError(fileError);
    const text = validateChanges(changes);
    if (!text.ok) return setLocalError(text.error);

    setPending(true);
    let uploaded: string | null = null;
    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return setLocalError(REMIX_NOT_CONFIGURED);
      const photo = await preparePhoto(file).catch(() => null);
      if (!photo || !isPhotoType(photo.type)) {
        return setLocalError("We couldn't read that photo. Please try a JPEG, PNG or WebP.");
      }
      const path = photoPathFor(userId, photo.type);
      const { error } = await supabase.storage
        .from("remix-photos")
        .upload(path, photo, { contentType: photo.type, upsert: false });
      if (error) return setLocalError(UPLOAD_FAILED);
      uploaded = path;

      const formData = new FormData();
      formData.set("slug", slug);
      formData.set("photo_path", path);
      formData.set("changes", text.value);
      const res = await action(null, formData);
      focusLimit.current = res?.status === "limit" || (res?.status === "pending" && res.remaining <= 0);
      setResult(res);
      if (res?.status === "pending") {
        setLeft(res.remaining);
        setChanges("");
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch {
      // The action never answered: tidy up the photo if it was uploaded (Storage refuses if a
      // remix already uses it).
      if (uploaded) await createSupabaseBrowserClient()?.storage.from("remix-photos").remove([uploaded]).catch(() => undefined);
      setLocalError(UPLOAD_FAILED);
    } finally {
      setPending(false);
    }
  }

  const limitMessage =
    result?.status === "limit" ? result.message : left <= 0 ? limitReachedText("remix", limit) : null;
  const error = localError ?? problem(result);

  useEffect(() => {
    if (limitMessage && focusLimit.current) limitRef.current?.focus();
    focusLimit.current = false;
  }, [limitMessage]);

  return (
    <div className="space-y-4">
      {/* One persistent live region: the thanks message and, once none are left, the limit box. */}
      <div role="status" className="space-y-4">
        {result?.status === "pending" && (
          <p className="rounded-2xl bg-white p-4 font-semibold text-herb ring-1 ring-herb/30">{result.message}</p>
        )}
        {limitMessage && (
          <p
            ref={limitRef}
            tabIndex={-1}
            className="rounded-2xl bg-white p-4 font-semibold ring-1 ring-cocoa/10 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper"
          >
            {limitMessage}
          </p>
        )}
      </div>
      {limitMessage ? null : (
        // noValidate: the checks below give friendlier messages, announced in one place.
        <form onSubmit={submit} noValidate className="space-y-5" aria-busy={pending}>
          <div className="space-y-2">
            <label htmlFor={photoId} className="block font-bold">
              Photo of your remix
            </label>
            <input
              ref={fileRef}
              id={photoId}
              name="photo"
              type="file"
              accept={PHOTO_ACCEPT}
              required
              aria-describedby={photoHintId}
              className="block w-full rounded-2xl border-2 border-dashed border-cocoa/30 bg-white p-3 text-cocoa file:mr-4 file:min-h-11 file:rounded-full file:border-0 file:bg-peach-light file:px-4 file:font-bold file:text-cocoa focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper"
            />
            <p id={photoHintId} className="text-sm text-cocoa-soft">
              JPEG, PNG or WebP, up to 5 MB. We resize it and remove location data before it&rsquo;s uploaded.
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor={changesId} className="block font-bold">
              What you changed
            </label>
            <textarea
              id={changesId}
              name="changes"
              required
              maxLength={CHANGES_MAX_LENGTH}
              rows={5}
              value={changes}
              onChange={(e) => setChanges(e.target.value)}
              aria-describedby={changesHintId}
              placeholder="Swapped cream for cashew paste, added extra chilli..."
              className={field}
            />
            <p id={changesHintId} className="text-sm text-cocoa-soft">
              {remixesLeftText(left, limit)}
            </p>
          </div>
          {error && (
            <p role="alert" className={`rounded-2xl border-2 border-copper bg-white p-3 ${errorText}`}>
              {error}
            </p>
          )}
          <SubmitButton pending={pending} className={primaryButton}>
            {pending ? "Posting…" : "Post my remix"}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
