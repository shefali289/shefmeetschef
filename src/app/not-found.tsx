import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-4 py-12 text-center sm:flex-row sm:text-left">
      <div className="w-48 shrink-0 overflow-hidden rounded-[2rem] bg-peach shadow-lift ring-8 ring-white sm:w-56">
        <Image
          src="/brand/shef-thinking.webp"
          alt="Shef looking thoughtful in her kitchen"
          width={1086}
          height={1448}
          sizes="14rem"
          className="aspect-[3/4] h-auto w-full object-cover"
        />
      </div>
      <div>
        <p className="font-hand text-2xl text-herb">hmm, that&rsquo;s not on the menu</p>
        <h1 className="mt-1 text-4xl font-extrabold text-cocoa">
          <span className="brush">Page not found</span>
        </h1>
        <p className="mt-4 text-lg text-cocoa">
          This page may have moved, or the recipe is still in Shef&rsquo;s head. Try the recipe list instead.
        </p>
        <Link
          href="/recipes"
          className="press mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-copper px-6 py-2 font-bold text-white shadow-soft hover:bg-copper-dark focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cocoa"
        >
          Browse recipes
        </Link>
      </div>
    </main>
  );
}
