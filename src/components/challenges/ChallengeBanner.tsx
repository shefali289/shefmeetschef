import Link from "next/link";
import { daysLeftText } from "@/lib/challenges/dates";
import type { Challenge } from "@/lib/challenges/types";

export interface ChallengeBannerProps {
  challenge: Pick<Challenge, "id" | "title" | "endsOn" | "baseRecipeSlug" | "baseRecipeTitle">;
  /** NZ date YYYY-MM-DD used for the countdown. */
  today: string;
  /** True on the base recipe's own page: links to Remix this instead of the recipe. */
  onBaseRecipe?: boolean;
}

export const CHALLENGE_HASHTAG = "#ShefMeetsChefRemix";

const primary =
  "press inline-flex min-h-11 items-center justify-center rounded-full bg-copper px-6 py-2 font-bold text-white shadow-soft hover:bg-copper-dark focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cocoa";
const secondary =
  "press inline-flex min-h-11 items-center justify-center rounded-full border-2 border-copper bg-white px-5 py-2 font-bold text-cocoa hover:bg-blush-light focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper";

/** "This week's remix challenge": title, hashtag, countdown and where to go next. */
export default function ChallengeBanner({ challenge, today, onBaseRecipe = false }: ChallengeBannerProps) {
  const headingId = `challenge-banner-${challenge.id}`;
  const slug = challenge.baseRecipeSlug;

  return (
    <section aria-labelledby={headingId} className="rounded-[1.75rem] bg-peach p-5 shadow-soft ring-1 ring-cocoa/10 sm:p-6">
      <h2 id={headingId} className="font-hand text-2xl text-herb">
        This week&rsquo;s remix challenge
      </h2>
      <p className="mt-1 text-2xl font-extrabold text-cocoa">{challenge.title}</p>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-semibold text-cocoa">
        <span>{CHALLENGE_HASHTAG}</span>
        <span>{daysLeftText(today, challenge.endsOn)}</span>
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {slug && onBaseRecipe && (
          <Link href={`/recipes/${slug}/remix`} className={primary}>
            Remix this
          </Link>
        )}
        {slug && !onBaseRecipe && (
          <Link href={`/recipes/${slug}`} className={primary}>
            Cook {challenge.baseRecipeTitle ?? "the recipe"}
          </Link>
        )}
        <Link href={`/challenges/${challenge.id}`} className={secondary}>
          See the challenge
        </Link>
      </div>
    </section>
  );
}
