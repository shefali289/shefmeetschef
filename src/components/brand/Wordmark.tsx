import Link from "next/link";

function ChefHat({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 30" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M9 21v-3.6a5.2 5.2 0 0 1-.4-10A7.6 7.6 0 0 1 23.4 7.4a5.2 5.2 0 0 1-.4 10V21Z" fill="#fff" />
        <rect x="8.5" y="21" width="15" height="5.5" rx="1.5" fill="#fff" />
      </g>
      <path d="M13 16.5v2.5M16 15.5v3.5M19 16.5v2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function Heart({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 14" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <path
        d="M8 13S1 8.8 1 4.6A3.4 3.4 0 0 1 8 3a3.4 3.4 0 0 1 7 1.6C15 8.8 8 13 8 13Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** The logo: chef hat, calligraphy name and a little heart. */
export default function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group inline-flex min-h-11 min-w-0 items-center gap-1 sm:gap-1.5 rounded-md font-script text-cocoa focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper ${className}`}
    >
      <ChefHat className="h-6 w-7 sm:h-7 sm:w-8 transition-transform duration-300 group-hover:-rotate-6" />
      <span className="text-[1.6rem] leading-none tracking-wide sm:text-[1.85rem]">shefmeetschef</span>
      <Heart className="h-3 w-3 mb-2 self-end text-copper/70 transition-transform duration-300 group-hover:scale-125" />
    </Link>
  );
}
