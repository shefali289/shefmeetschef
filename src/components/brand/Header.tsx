import Link from "next/link";
import Wordmark from "./Wordmark";

const navLink =
  "inline-flex min-h-11 items-center rounded-full px-4 font-semibold text-shef-navy hover:bg-herb-light focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-shef-navy";

/** Site header. `children` is a slot for extra actions, such as the auth button. */
export default function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="border-b border-shef-orange/20 bg-shef-cream">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
        <Wordmark />
        <nav aria-label="Main" className="flex items-center gap-2">
          <Link href="/recipes" className={navLink}>
            Recipes
          </Link>
          {children}
        </nav>
      </div>
    </header>
  );
}
