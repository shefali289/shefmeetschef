"use client";
import Link from "next/link";
import { useActionState, useId } from "react";
import {
  HISTORY_MAX_TURNS,
  QUESTION_MAX_LENGTH,
  type AskResult,
  type ShefVersion,
} from "@/lib/ask-shef/types";
import { FREE_LIMITS, limitReachedText, questionsLeftText } from "@/lib/limits";
import { saveRemixPrefill, shefVersionToChanges } from "@/lib/remix/changes";
import ShefVersionToggle from "./ShefVersionToggle";

export interface AskShefProps {
  /** Recipe slug; the server loads the recipe itself. */
  slug: string;
  /** False when Supabase or Gemini is not set up. */
  configured: boolean;
  signedIn: boolean;
  /** Questions left today. */
  remaining: number;
  limit?: number;
  /** The recipe on screen, for the Shef's version toggle. */
  original: ShefVersion;
  action: (prev: AskResult | null, formData: FormData) => Promise<AskResult>;
  /** Offer "Post this as my remix" under Shef's version (opt-in: Shef recipes only, not outside reels). */
  remixable?: boolean;
}

interface Entry {
  question: string;
  answer: string;
  shefVersion: ShefVersion | null;
}

interface State {
  entries: Entry[];
  remaining: number;
  limitMessage: string | null;
  error: string | null;
  signedOut: boolean;
  notConfigured: string | null;
  last: AskResult | null;
  /** True when the newest entry was the last result, so the status region shows it. */
  newestInRegion: boolean;
}

const button =
  "press inline-flex min-h-11 items-center justify-center rounded-full px-6 py-2 font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cocoa";

/** Shef's round avatar. A CSS background (decorative), so answers stay plain text with no images. */
function Avatar({ size = "size-12" }: { size?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`${size} shrink-0 rounded-full bg-peach bg-cover bg-center shadow-soft ring-2 ring-white`}
      style={{ backgroundImage: "url(/brand/shef-avatar-cooking.webp)" }}
    />
  );
}

/** One question and Shef's answer, as plain text, with the allergy note. */
function AnswerCard({ entry }: { entry: Entry }) {
  return (
    <div className="space-y-3">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-blush-light px-4 py-2 text-cocoa">
        <span className="sr-only">You asked: </span>
        {entry.question}
      </p>
      <div className="flex items-start gap-3">
        <Avatar size="size-11" />
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-soft ring-1 ring-cocoa/10">
          <p className="sr-only">Shef says:</p>
          <p className="leading-relaxed break-words whitespace-pre-line text-cocoa">{entry.answer}</p>
          <p className="mt-2 text-sm text-cocoa-soft">
            Cooking for allergies? Always check every label and ingredient yourself.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Shef's version, then a link to post it as a remix with "what I changed" filled in. */
function VersionAndRemix({ slug, original, version, remixable }: { slug: string; original: ShefVersion; version: ShefVersion; remixable: boolean }) {
  return (
    <>
      <ShefVersionToggle original={original} version={version} />
      {remixable && (
        <p className="mt-3">
          <Link
            href={`/recipes/${slug}/remix`}
            // Stored only when they choose to post it, for this recipe, until the form reads it.
            onClick={() => saveRemixPrefill(slug, shefVersionToChanges(original, version))}
            className={`${button} border-2 border-copper bg-white text-cocoa hover:bg-blush-light`}
          >
            Post this as my remix
          </Link>
        </p>
      )}
    </>
  );
}

function reduce(prev: State, res: AskResult): State {
  const base = { ...prev, last: res, error: null, newestInRegion: false };
  switch (res.status) {
    case "ok":
      return {
        ...base,
        remaining: res.remaining,
        newestInRegion: true,
        // That was the last one today: hide the form, keep the answer on screen.
        limitMessage: res.remaining <= 0 ? limitReachedText("ask", res.limit) : prev.limitMessage,
        entries: [...prev.entries, { question: res.question, answer: res.answer, shefVersion: res.shefVersion }],
      };
    case "limit":
      return { ...base, remaining: 0, limitMessage: res.message };
    case "signed-out":
      return { ...base, signedOut: true };
    case "not-configured":
      return { ...base, notConfigured: res.message };
    default:
      return { ...base, error: res.message };
  }
}

/** Ask Shef chat on a recipe page. Answers are rendered as plain text, never HTML. */
export default function AskShef({
  slug,
  configured,
  signedIn,
  remaining,
  limit = FREE_LIMITS.ask,
  original,
  action,
  remixable = false,
}: AskShefProps) {
  const headingId = useId();
  const fieldId = useId();
  const hintId = useId();
  const [state, formAction, pending] = useActionState(
    async (prev: State, formData: FormData): Promise<State> => {
      // Follow-ups: the last few turns, held in the browser only.
      const history = prev.entries
        .slice(-HISTORY_MAX_TURNS)
        .map(({ question, answer }) => ({ question, answer }));
      formData.set("history", JSON.stringify(history));
      try {
        return reduce(prev, await action(prev.last, formData));
      } catch {
        return {
          ...prev,
          newestInRegion: false,
          error: "Shef couldn't answer just now. Please try again in a minute.",
        };
      }
    },
    {
      entries: [],
      remaining,
      limitMessage: remaining <= 0 ? limitReachedText("ask", limit) : null,
      error: null,
      signedOut: false,
      notConfigured: configured ? null : "Ask Shef is not set up yet. Check back soon!",
      last: null,
      newestInRegion: false,
    },
  );

  // The newest answer lives in the status region (announced once); earlier ones in the list.
  const showNewest = state.newestInRegion && !pending;
  const newest = showNewest ? state.entries[state.entries.length - 1] : undefined;
  const older = showNewest ? state.entries.slice(0, -1) : state.entries;

  const signInHref = `/sign-in?next=${encodeURIComponent(`/recipes/${slug}`)}`;

  let body: React.ReactNode;
  if (state.notConfigured) {
    body = (
      <p className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-cocoa/10">
        {state.notConfigured} Once it is, you&rsquo;ll be able to sign in to ask Shef about this recipe.
      </p>
    );
  } else if (!signedIn || state.signedOut) {
    body = (
      <p className="mt-4">
        <Link href={signInHref} className={`${button} bg-copper text-white shadow-soft hover:bg-copper-dark`}>
          Sign in to ask Shef
        </Link>
      </p>
    );
  } else {
    body = (
      <>
        {older.length > 0 && (
          <ol aria-label="Earlier answers from Shef" className="mt-5 space-y-5">
            {older.map((e, i) => (
              <li key={i}>
                <AnswerCard entry={e} />
                {e.shefVersion && (
                  <VersionAndRemix slug={slug} original={original} version={e.shefVersion} remixable={remixable} />
                )}
              </li>
            ))}
          </ol>
        )}

        {/* The one live region: always mounted, so screen readers track it before anything changes. */}
        <div role="status" className="mt-5">
          {pending ? (
            <p className="font-hand text-2xl text-cocoa-soft">Shef is thinking&hellip;</p>
          ) : newest ? (
            <AnswerCard entry={newest} />
          ) : state.limitMessage ? (
            <p className="rounded-2xl bg-white p-4 font-semibold ring-1 ring-cocoa/10">{state.limitMessage}</p>
          ) : null}
        </div>
        {!pending && newest?.shefVersion && (
          <VersionAndRemix slug={slug} original={original} version={newest.shefVersion} remixable={remixable} />
        )}
        {!pending && newest && state.limitMessage && (
          <p className="mt-5 rounded-2xl bg-white p-4 font-semibold ring-1 ring-cocoa/10">{state.limitMessage}</p>
        )}

        {!state.limitMessage && (
          <form action={formAction} className="mt-5 space-y-3" aria-busy={pending}>
            <input type="hidden" name="slug" value={slug} />
            <label htmlFor={fieldId} className="block font-bold">
              Your question for Shef
            </label>
            <textarea
              id={fieldId}
              name="question"
              required
              maxLength={QUESTION_MAX_LENGTH}
              rows={3}
              aria-describedby={hintId}
              placeholder="Can I make this vegan? Less spicy for the kids?"
              className="block w-full rounded-2xl border-2 border-cocoa/20 bg-white px-4 py-3 text-cocoa placeholder:text-cocoa-soft focus-visible:border-copper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper"
            />
            <p id={hintId} className="text-sm text-cocoa-soft">
              {questionsLeftText(state.remaining, limit)}
            </p>
            {state.error && (
              <p role="alert" className="rounded-2xl border-2 border-copper bg-white p-3 font-semibold">
                {state.error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className={`${button} bg-copper text-white shadow-soft hover:bg-copper-dark disabled:opacity-70`}
            >
              Ask Shef
            </button>
          </form>
        )}
      </>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-[1.75rem] bg-gradient-to-br from-peach-light via-cream to-blush-light p-5 shadow-soft ring-1 ring-cocoa/10 sm:p-6"
    >
      <div className="flex items-center gap-3">
        <Avatar size="size-14" />
        <div>
          <h2 id={headingId} className="font-hand text-4xl leading-none font-bold text-cocoa">
            Ask Shef
          </h2>
          <p className="text-cocoa-soft">Swaps, spice levels, vegan or Jain versions: just ask.</p>
        </div>
      </div>
      {body}
    </section>
  );
}
