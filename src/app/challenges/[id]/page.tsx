import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { pickWinner } from "@/app/admin/challenges/actions";
import { CHALLENGE_HASHTAG } from "@/components/challenges/ChallengeBanner";
import WinnerBadge from "@/components/challenges/WinnerBadge";
import Reveal from "@/components/motion/Reveal";
import RemixCard from "@/components/remix/RemixCard";
import { adminGate, getViewer } from "@/lib/auth/session";
import { getChallenge } from "@/lib/challenges/challenges";
import { daysLeftText, formatChallengeDates, nzToday } from "@/lib/challenges/dates";
import { CHALLENGES_NOT_CONFIGURED } from "@/lib/challenges/types";
import { markLiked } from "@/lib/remix/feed";
import PickWinnerForm from "./PickWinnerForm";

type Props = { params: Promise<{ id: string }> };

/** The viewer and the challenge, once per request (shared by metadata and the page). */
const loadPage = cache(async (id: string) => {
  const viewer = await getViewer();
  if (!viewer.supabase) return { viewer, admin: false, today: nzToday(), detail: null };
  // The admin is decided on the server; pickWinner checks again.
  const gate = viewer.user ? await adminGate() : null;
  const admin = gate?.state === "admin";
  const supabase = gate?.state === "admin" ? gate.supabase : viewer.supabase;
  const today = nzToday();
  const detail = await getChallenge(supabase, id, { admin, today });
  return { viewer, admin, today, detail };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { viewer, detail } = await loadPage((await params).id);
  if (!viewer.supabase) return { title: "Remix challenge" };
  if (!detail) return { title: "Challenge not found" };
  const { challenge } = detail;
  return {
    title: `${challenge.title}: remix challenge`,
    description: challenge.description ?? `Shef's remix challenge: ${challenge.title}.`,
    alternates: { canonical: `/challenges/${challenge.id}` },
  };
}

const remixButton =
  "press inline-flex min-h-11 items-center justify-center rounded-full bg-copper px-6 py-2 font-bold text-white shadow-soft hover:bg-copper-dark focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cocoa";
const card = "rounded-[1.5rem] bg-white p-5 font-semibold shadow-soft ring-1 ring-cocoa/10";
const pill =
  "press inline-flex min-h-11 items-center justify-center rounded-full border-2 border-copper bg-white px-5 py-2 font-bold text-cocoa hover:bg-blush-light focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper";

/** One challenge: its entries (approved only), and for the admin, Pick as winner after the end. */
export default async function ChallengePage({ params }: Props) {
  const { viewer, admin, today, detail } = await loadPage((await params).id);
  if (!viewer.supabase) {
    return (
      <main id="main" className="mx-auto max-w-5xl px-4 pt-8 pb-16">
        <h1 className="text-4xl font-extrabold text-cocoa">Remix challenge</h1>
        <p className={`mt-6 ${card}`}>{CHALLENGES_NOT_CONFIGURED}</p>
      </main>
    );
  }

  if (!detail) notFound();

  const { challenge, open, ended, hasMore } = detail;
  // Whether each heart starts pressed: the viewer's own likes, read through their session.
  const entries = viewer.user ? await markLiked(viewer.supabase, viewer.user.id, detail.entries) : detail.entries;
  const returnTo = `/challenges/${challenge.id}`;

  return (
    <main id="main" className="mx-auto max-w-5xl px-4 pt-8 pb-16">
      <div className="animate-fade-up">
        <p className="font-hand text-2xl text-herb">
          {open ? "this week’s remix challenge" : ended ? "past remix challenge" : "coming up"}
        </p>
        <h1 className="mt-1 text-4xl font-extrabold text-cocoa">
          <span className="brush">{challenge.title}</span>
        </h1>
        {challenge.description && (
          <p className="mt-4 text-lg break-words whitespace-pre-line text-cocoa">{challenge.description}</p>
        )}
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-semibold text-cocoa">
          <span>{formatChallengeDates(challenge.startsOn, challenge.endsOn)}</span>
          <span>{CHALLENGE_HASHTAG}</span>
          {open && <span>{daysLeftText(today, challenge.endsOn)}</span>}
        </p>
        {challenge.baseRecipeSlug && challenge.baseRecipeTitle && (
          <p className="mt-2 text-cocoa">
            Base recipe:{" "}
            <Link
              href={`/recipes/${challenge.baseRecipeSlug}`}
              className="font-script text-2xl text-copper-ink underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper"
            >
              {challenge.baseRecipeTitle}
            </Link>
          </p>
        )}
        {open && (
          <div className="mt-5 flex flex-wrap items-center gap-4">
            {challenge.baseRecipeSlug && (
              <Link href={`/recipes/${challenge.baseRecipeSlug}/remix`} className={remixButton}>
                Remix this
              </Link>
            )}
            <p className="font-hand text-xl text-cocoa-soft">Entries may be featured in Shef&rsquo;s reel.</p>
          </div>
        )}
        {challenge.winner && (
          <p className="mt-5 rounded-2xl bg-herb-light p-4 font-bold text-cocoa">
            {challenge.winner.authorName}&rsquo;s remix won. Featured in Shef&rsquo;s reel!
          </p>
        )}
        {admin && !ended && (
          <p className="mt-4 text-cocoa-soft">You can pick a winner once the challenge has ended.</p>
        )}
      </div>

      <section aria-labelledby="entries-heading" className="mt-10">
        <h2 id="entries-heading" className="text-2xl font-extrabold text-cocoa">
          Entries{admin ? " (most liked first)" : ""}
        </h2>
        {entries.length === 0 ? (
          <p className={`mt-4 ${card}`}>No entries yet. Remix the base recipe while it is open to enter.</p>
        ) : (
          <ul aria-label="Entries" className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((entry, i) => (
              <Reveal as="li" key={entry.id} delay={Math.min(i, 5) * 60} className="flex flex-col gap-2">
                {entry.isWinner && (
                  <div>
                    <WinnerBadge />
                  </div>
                )}
                <RemixCard remix={entry} signedIn={viewer.user !== null} returnTo={returnTo} showRecipe={false} />
                {admin && ended && entry.isWinner && (
                  <p className="mt-1 text-center font-bold text-herb">Current winner</p>
                )}
                {admin && ended && !entry.isWinner && (
                  <PickWinnerForm
                    challengeId={challenge.id}
                    remixId={entry.id}
                    authorName={entry.authorName}
                    position={i + 1}
                    total={entries.length}
                    action={pickWinner}
                  />
                )}
              </Reveal>
            ))}
          </ul>
        )}
        {hasMore && (
          <p className="mt-6 text-center">
            <Link href={`/remixes?challenge=${challenge.id}`} className={pill}>
              See all entries
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}
