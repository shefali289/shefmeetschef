import type { Metadata } from "next";
import Link from "next/link";
import CookbookAnnouncer from "@/components/cookbook/CookbookAnnouncer";
import RecipePlaceholder from "@/components/recipe/RecipePlaceholder";
import { adminGate } from "@/lib/auth/session";
import { loadBannedUsers, loadModerationQueue, type QueueItem } from "@/lib/moderation/queue";
import { signRemixPhotos } from "@/lib/remix/photos";
import { approveRemix, banUser, hideRemix, unbanUser } from "./actions";
import { BanButton, ModerationButton } from "./ModerationControls";

export const metadata: Metadata = { title: "Remixes to check", robots: { index: false, follow: false } };

const QUEUE_HEADING = "queue-heading";
const BANNED_HEADING = "banned-heading";

function statusText(item: QueueItem): string {
  if (item.status === "pending") return "Waiting for a quick check";
  if (item.status === "hidden") return "Hidden by reports";
  return "Live, reported";
}

const reportsText = (n: number) => `${n} ${n === 1 ? "report" : "reports"}`;

function QueueCard({ item, photoUrl }: { item: QueueItem; photoUrl: string | null }) {
  const remixName = `${item.authorName}'s remix of ${item.recipeTitle}`;
  const remixFields = { remix_id: item.id, recipe_slug: item.recipeSlug };

  return (
    <article className="overflow-hidden rounded-[1.5rem] bg-white shadow-soft ring-1 ring-cocoa/10 sm:flex">
      {photoUrl ? (
        // Short-lived signed URL: a plain img, so it is not cached by the image optimiser.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={remixName} loading="lazy" className="aspect-square w-full object-cover sm:w-48" />
      ) : (
        <RecipePlaceholder className="aspect-square w-full sm:w-48" />
      )}
      <div className="flex-1 space-y-3 p-4">
        <h3 className="font-bold">
          {item.authorName} <span className="font-normal text-cocoa-soft">remixed</span>{" "}
          {item.recipeSlug ? (
            <Link
              href={`/recipes/${item.recipeSlug}`}
              className="inline-flex min-h-11 items-center text-copper-ink underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper"
            >
              {item.recipeTitle}
            </Link>
          ) : (
            item.recipeTitle
          )}
        </h3>
        <p className="inline-block rounded-full bg-peach-light px-3 py-1 text-sm font-bold">{statusText(item)}</p>
        <p className="leading-relaxed break-words whitespace-pre-line">{item.changes}</p>
        {item.aiReason && (
          <p className="text-sm">
            <span className="font-semibold">AI check{item.aiVerdict ? ` (${item.aiVerdict})` : ""}:</span> {item.aiReason}
          </p>
        )}
        {item.reportCount > 0 && (
          <div className="text-sm">
            <p className="font-semibold">{reportsText(item.reportCount)}</p>
            {item.reportReasons.length > 0 && (
              <ul className="list-disc pl-5">
                {item.reportReasons.map((reason, i) => (
                  <li key={i} className="break-words">
                    {reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-start gap-2">
          {/* A banned cook's remix cannot be approved (the database refuses): unban them first. */}
          {!item.authorBanned && (
            <ModerationButton
              action={approveRemix}
              fields={remixFields}
              text="Approve"
              label={`Approve ${remixName}`}
              successMessage={`Approved ${remixName}`}
              focusAfterId={QUEUE_HEADING}
              primary
            />
          )}
          <ModerationButton
            action={hideRemix}
            fields={remixFields}
            text="Hide"
            label={`Hide ${remixName}`}
            successMessage={`Hid ${remixName}`}
            focusAfterId={QUEUE_HEADING}
          />
          {item.authorBanned ? (
            <ModerationButton
              action={unbanUser}
              fields={{ user_id: item.userId }}
              text={`Unban ${item.authorName}`}
              label={`Unban ${item.authorName}`}
              successMessage={`${item.authorName} is no longer banned`}
              focusAfterId={QUEUE_HEADING}
            />
          ) : (
            <BanButton action={banUser} userId={item.userId} name={item.authorName} focusAfterId={QUEUE_HEADING} />
          )}
        </div>
      </div>
    </article>
  );
}

/** The moderation queue: pending and reported remixes, and banned cooks. The layout handles non-admins. */
export default async function AdminRemixesPage() {
  const gate = await adminGate();
  if (gate.state !== "admin") return null;

  const [{ items: queue, failed }, banned] = await Promise.all([
    loadModerationQueue(gate.supabase),
    loadBannedUsers(gate.supabase),
  ]);
  // Signed with the admin's own session: storage RLS lets admins read every remix photo.
  const urls = queue.length ? await signRemixPhotos(gate.supabase, queue.map((i) => i.photoPath)) : {};

  return (
    <main>
      <h1 className="text-3xl font-bold">Remixes to check</h1>
      <p className="mt-1 text-cocoa-soft">
        New remixes the AI check could not approve, and remixes people reported. Oldest first.
      </p>
      <CookbookAnnouncer />

      <section aria-labelledby={QUEUE_HEADING} className="mt-6">
        <h2 id={QUEUE_HEADING} tabIndex={-1} className="text-xl font-bold focus:outline-none">
          Queue
        </h2>
        {failed ? (
          <p role="alert" className="mt-3 font-semibold text-copper-ink">
            Couldn&apos;t load the queue. Please refresh the page to try again.
          </p>
        ) : queue.length === 0 ? (
          <p className="mt-3">Nothing to check. Every remix has been looked at.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {queue.map((item) => (
              <li key={item.id}>
                <QueueCard item={item} photoUrl={urls[item.photoPath] ?? null} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={BANNED_HEADING} className="mt-8">
        <h2 id={BANNED_HEADING} tabIndex={-1} className="text-xl font-bold focus:outline-none">
          Banned cooks
        </h2>
        {banned.length === 0 ? (
          <p className="mt-3">No banned cooks.</p>
        ) : (
          <ul className="mt-3 divide-y divide-cocoa/10 rounded-lg border border-cocoa/15 bg-white">
            {banned.map((b) => (
              <li key={b.userId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-semibold">{b.name}</p>
                  <p className="text-sm">
                    {b.reason ?? "No reason given"} · banned{" "}
                    {new Date(b.createdAt).toLocaleDateString("en-NZ", { dateStyle: "medium" })}
                  </p>
                </div>
                <ModerationButton
                  action={unbanUser}
                  fields={{ user_id: b.userId }}
                  text={`Unban ${b.name}`}
                  label={`Unban ${b.name}`}
                  successMessage={`${b.name} is no longer banned`}
                  focusAfterId={BANNED_HEADING}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
