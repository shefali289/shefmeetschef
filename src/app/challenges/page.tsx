import type { Metadata } from "next";
import Link from "next/link";
import { CHALLENGE_HASHTAG } from "@/components/challenges/ChallengeBanner";
import { getViewer } from "@/lib/auth/session";
import { listChallenges } from "@/lib/challenges/challenges";
import { daysLeftText, formatChallengeDates, nzToday } from "@/lib/challenges/dates";
import { CHALLENGES_NOT_CONFIGURED } from "@/lib/challenges/types";

export const metadata: Metadata = {
  title: "Remix challenges",
  description: "Shef's weekly remix challenges: this week's recipe and the past winners.",
  alternates: { canonical: "/challenges" },
};

const titleLink =
  "text-xl font-extrabold text-cocoa underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper inline-flex min-h-11 items-center";
const card = "rounded-[1.5rem] bg-white p-5 shadow-soft ring-1 ring-cocoa/10";

/** The open challenge, then past ones newest first with their winners. */
export default async function ChallengesPage() {
  const viewer = await getViewer();
  const today = nzToday();

  let content: React.ReactNode;
  if (!viewer.supabase) {
    content = <p className={`${card} font-semibold`}>{CHALLENGES_NOT_CONFIGURED}</p>;
  } else {
    const { current, past } = await listChallenges(viewer.supabase, today, { winnerPhotos: false });
    content =
      !current && past.length === 0 ? (
        <p className={`${card} font-semibold`}>No challenges yet. The first one is coming soon!</p>
      ) : (
        <>
          {current && (
            <section aria-labelledby="this-week-heading" className={`${card} bg-peach`}>
              <h2 id="this-week-heading" className="font-hand text-2xl text-herb">
                This week
              </h2>
              <Link href={`/challenges/${current.id}`} className={titleLink}>
                {current.title}
              </Link>
              <p className="mt-1 flex flex-wrap gap-x-4 font-semibold text-cocoa">
                <span>{CHALLENGE_HASHTAG}</span>
                <span>{daysLeftText(today, current.endsOn)}</span>
              </p>
            </section>
          )}
          {past.length > 0 && (
            <section aria-labelledby="past-heading" className="mt-8">
              <h2 id="past-heading" className="text-2xl font-extrabold text-cocoa">
                Past challenges
              </h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                {past.map((c) => (
                  <li key={c.id} className={card}>
                    <Link href={`/challenges/${c.id}`} className={titleLink}>
                      {c.title}
                    </Link>
                    <p className="text-cocoa-soft">{formatChallengeDates(c.startsOn, c.endsOn)}</p>
                    {c.winner && <p className="mt-2 font-bold text-herb">Winner: {c.winner.authorName}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      );
  }

  return (
    <main id="main" className="mx-auto max-w-5xl px-4 pt-8 pb-16">
      <div className="animate-fade-up">
        <p className="font-hand text-2xl text-herb">cook it your way</p>
        <h1 className="mt-1 text-4xl font-extrabold text-cocoa">
          <span className="brush">Remix challenges</span>
        </h1>
        <p className="mt-4 text-lg text-cocoa">
          Each week Shef picks a recipe. Remix it, post your photo, and you might be featured in Shef&rsquo;s reel.
        </p>
      </div>
      <div className="mt-8">{content}</div>
    </main>
  );
}
