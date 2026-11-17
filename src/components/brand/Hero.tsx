import Link from "next/link";
import HerbSprig from "./HerbSprig";

/** Swap this file in /public for Shefali's real illustration. */
export const SHEF_AVATAR = "/shef-avatar.svg";
const FOLLOW_URL = "https://www.instagram.com/shefmeetschef/";

const button =
  "inline-flex min-h-11 items-center justify-center rounded-full px-6 py-2 font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-shef-navy";

export default function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden px-4 pt-10 pb-12">
      <HerbSprig className="absolute top-4 right-4 opacity-60" />
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={SHEF_AVATAR}
          alt="Illustration of Shef in her kitchen"
          width={160}
          height={160}
          className="h-40 w-40 shrink-0 rounded-full border-4 border-white shadow-md"
        />
        <div>
          <h1 id="hero-heading" className="text-4xl font-extrabold text-shef-navy sm:text-5xl">
            Hi, I&rsquo;m Shef
          </h1>
          <p className="mt-3 text-lg text-shef-navy">Raw plates, honest bites &amp; foodie experiments</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link href="/recipes" className={`${button} bg-shef-orange text-white hover:bg-shef-orange-dark`}>
              Browse recipes
            </Link>
            <a
              href={FOLLOW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${button} border-2 border-shef-orange bg-white text-shef-navy hover:bg-shef-cream`}
            >
              Follow @shefmeetschef<span className="sr-only"> (opens in new tab)</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
