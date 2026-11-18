import Link from "next/link";
import FollowButtons from "./FollowButtons";
import { Heart } from "./Wordmark";

const link =
  "link-underline inline-flex min-h-11 items-center font-semibold text-cream focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cream";

export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative mt-auto overflow-hidden bg-cocoa px-4 pt-12 pb-8 text-cream">
      <div aria-hidden="true" className="pointer-events-none absolute -top-20 right-0 h-48 w-48 rounded-full bg-copper/30 blur-3xl" />
      <div className="relative mx-auto flex max-w-5xl flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-hand text-4xl text-blush">
            good food, good mood
            <Heart className="h-5 w-5" />
          </p>
          <p className="mt-2 max-w-xs text-cream/90">
            Indian, fusion and everyday home cooking from a sunny kitchen in New Zealand.
          </p>
          <nav aria-label="Footer" className="mt-3 flex flex-wrap gap-x-6">
            <Link href="/recipes" className={link}>
              All recipes
            </Link>
            <Link href="/remixes" className={link}>
              Remixes
            </Link>
          </nav>
        </div>
        <FollowButtons tone="dark" />
      </div>
      <p className="relative mx-auto mt-10 max-w-5xl border-t border-cream/15 pt-6 text-sm text-cream/85">
        &copy; {year} ShefMeetsChef. Made with love in Aotearoa.
      </p>
    </footer>
  );
}
