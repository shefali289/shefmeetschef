import Link from "next/link";
import { deleteRemix } from "@/app/remixes/actions";
import ConfirmDelete from "@/components/cookbook/ConfirmDelete";
import RecipePlaceholder from "@/components/recipe/RecipePlaceholder";
import { statusLabel } from "@/lib/remix/status";
import type { OwnRemixCard, RemixCardData, RemixStatus } from "@/lib/remix/types";
import LikeButton from "./LikeButton";
import ReportButton from "./ReportButton";

export interface RemixCardProps {
  /** The owner's cards may carry why it is hidden (hiddenBy, aiReason). */
  remix: RemixCardData & Partial<Pick<OwnRemixCard, "hiddenBy" | "aiReason">>;
  signedIn: boolean;
  /** Where sign-in links send the visitor back to. */
  returnTo: string;
  /** Set for the owner's own view: shows the status and a delete button. */
  ownStatus?: RemixStatus;
  /** Links to the recipe it remixes (off on the recipe's own page). */
  showRecipe?: boolean;
}

const STATUS_STYLE: Record<RemixStatus, string> = {
  approved: "bg-herb text-white",
  pending: "bg-peach-light text-cocoa",
  hidden: "bg-cocoa/10 text-cocoa",
};

/** One remix: photo, who made it, what they changed (plain text) and its likes. */
export default function RemixCard({ remix, signedIn, returnTo, ownStatus, showRecipe = true }: RemixCardProps) {
  const own = ownStatus !== undefined;
  const label = own ? statusLabel(ownStatus, { hiddenBy: remix.hiddenBy, aiReason: remix.aiReason }) : null;
  const why = own && label !== statusLabel(ownStatus) ? label : null;
  const alt = own ? `Your remix of ${remix.recipeTitle}` : `${remix.authorName}'s remix of ${remix.recipeTitle}`;

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[1.75rem] bg-white shadow-soft ring-1 ring-cocoa/10">
      {remix.photoUrl ? (
        // Short-lived signed URLs: a plain img, so they are not cached by the image optimiser.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={remix.photoUrl} alt={alt} loading="lazy" className="aspect-square w-full object-cover" />
      ) : (
        <RecipePlaceholder className="aspect-square w-full" />
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-cocoa">
            {own ? "Your remix" : remix.authorName}
            {showRecipe && remix.recipeSlug && (
              <>
                {" "}
                <span className="font-normal text-cocoa-soft">of</span>{" "}
                <Link
                  href={`/recipes/${remix.recipeSlug}`}
                  className="inline-flex min-h-11 items-center text-copper-ink underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper"
                >
                  {remix.recipeTitle}
                </Link>
              </>
            )}
          </h3>
          {own && (
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${STATUS_STYLE[ownStatus]}`}>
              {statusLabel(ownStatus)}
            </span>
          )}
        </div>
        {/* Why it is hidden, in full below the short pill (the AI's reason or "while Shef takes a look"). */}
        {why && <p className="text-sm font-semibold text-cocoa">{why}</p>}
        <p className="leading-relaxed break-words whitespace-pre-line text-cocoa">{remix.changes}</p>
        <div className="mt-auto">
          {own ? (
            <ConfirmDelete
              label="Delete my remix"
              message="Delete this remix and its photo? This can't be undone."
              fields={{ remix_id: remix.id, return_to: returnTo }}
              action={deleteRemix}
              successMessage="Remix deleted"
              focusAfterId="remixes-heading"
            />
          ) : (
            <div className="flex flex-wrap items-start gap-2">
              <LikeButton
                remixId={remix.id}
                authorName={remix.authorName}
                count={remix.likeCount}
                liked={remix.liked}
                signedIn={signedIn}
                returnTo={returnTo}
              />
              {/* Keeps the like count and "Report" apart in the text content (screen readers, tests). */}{" "}
              <ReportButton
                remixId={remix.id}
                authorName={remix.authorName}
                signedIn={signedIn}
                own={remix.mine === true}
                returnTo={returnTo}
              />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
