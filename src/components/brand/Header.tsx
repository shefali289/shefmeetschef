import Link from "next/link";
import Wordmark from "./Wordmark";

const navLink =
  "press inline-flex min-h-11 shrink-0 items-center rounded-full px-3 font-bold sm:px-4 text-cocoa hover:bg-blush-light focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper";

/** Sticky, translucent site header. `children` is a slot for extra actions, such as the auth button. */
export default function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-cocoa/10 bg-cream/80 backdrop-blur-md supports-[backdrop-filter]:bg-cream/70">
      <div className="mx-auto flex max-w-5xl flex-nowrap items-center justify-between gap-2 px-3 py-1.5 sm:px-4">
        <Wordmark />
        <nav aria-label="Main" className="flex shrink-0 items-center gap-1">
          <Link href="/recipes" className={navLink}>
            Recipes
          </Link>
          {children}
        </nav>
      </div>
    </header>
  );
}
