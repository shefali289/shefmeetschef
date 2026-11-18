import Link from "next/link";
import { REMIX_NOT_CONFIGURED } from "@/lib/remix/status";

export interface RemixThisButtonProps {
  slug: string;
  signedIn: boolean;
  /** False when Supabase is not set up. */
  configured: boolean;
}

const button =
  "press inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-copper px-6 py-2 font-bold text-white shadow-soft hover:bg-copper-dark focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cocoa";

/** "Remix this" link to the remix form; signed-out visitors sign in first and come back. */
export default function RemixThisButton({ slug, signedIn, configured }: RemixThisButtonProps) {
  const remixPath = `/recipes/${slug}/remix`;
  const noteId = `remix-not-set-up-${slug}`;

  if (!configured) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link href={remixPath} aria-describedby={noteId} className={button}>
          Remix this
        </Link>
        <p id={noteId} className="font-hand text-xl text-cocoa-soft">
          {REMIX_NOT_CONFIGURED}
        </p>
      </div>
    );
  }

  return (
    <Link href={signedIn ? remixPath : `/sign-in?next=${encodeURIComponent(remixPath)}`} className={button}>
      {signedIn ? "Remix this" : "Sign in to remix this"}
    </Link>
  );
}
