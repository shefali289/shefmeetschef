import type { Metadata } from "next";
import Link from "next/link";
import { adminGate } from "@/lib/auth/session";
import { formatChallengeDates } from "@/lib/challenges/dates";
import { createChallenge } from "./actions";
import ChallengeForm, { type ChallengeFormRecipe } from "./ChallengeForm";

export const metadata: Metadata = { title: "Challenges", robots: { index: false, follow: false } };

type ChallengeRow = { id: string; title: string; starts_on: string; ends_on: string; winner_remix_id: string | null };

/** Create weekly challenges and see every challenge. The layout handles non-admins. */
export default async function AdminChallengesPage() {
  const gate = await adminGate();
  if (gate.state !== "admin") return null;

  const [recipes, challenges] = await Promise.all([
    gate.supabase
      .from("recipes")
      .select("id, title, source, status")
      .eq("source", "shef")
      .eq("status", "live")
      .order("title")
      .returns<ChallengeFormRecipe[]>(),
    gate.supabase
      .from("challenges")
      .select("id, title, starts_on, ends_on, winner_remix_id")
      .order("starts_on", { ascending: false })
      .returns<ChallengeRow[]>(),
  ]);
  const list = challenges.data ?? [];

  return (
    <main>
      <h1 className="text-3xl font-bold">Weekly challenges</h1>

      <section aria-labelledby="new-challenge-heading" className="mt-6">
        <h2 id="new-challenge-heading" className="text-xl font-bold">
          New challenge
        </h2>
        <p className="mt-1 text-cocoa-soft">Runs Monday to Sunday NZ time unless you change the dates.</p>
        <div className="mt-3">
          <ChallengeForm recipes={recipes.data ?? []} action={createChallenge} />
        </div>
      </section>

      <section aria-labelledby="all-challenges-heading" className="mt-8">
        <h2 id="all-challenges-heading" className="text-xl font-bold">
          All challenges
        </h2>
        {challenges.error ? (
          <p role="alert" className="mt-3">
            Could not load challenges. Please try again.
          </p>
        ) : list.length === 0 ? (
          <p className="mt-3">No challenges yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-cocoa/10 rounded-lg border border-cocoa/15 bg-white">
            {list.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/challenges/${c.id}`}
                  className="flex min-h-11 flex-col px-4 py-3 hover:bg-cream focus-visible:outline-2 focus-visible:outline-copper"
                >
                  <span className="font-semibold">{c.title}</span>
                  <span className="text-sm">
                    {formatChallengeDates(c.starts_on, c.ends_on)}
                    {c.winner_remix_id ? " · winner picked" : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
