import Link from "next/link";

function ChefHat() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" className="shrink-0">
      <path
        d="M7 18v-4.2A4 4 0 0 1 6.5 6a5 5 0 0 1 11 0 4 4 0 0 1-.5 7.8V18Z"
        fill="#ffffff"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M7 18h10v2.5H7Z" fill="currentColor" />
    </svg>
  );
}

export default function Wordmark() {
  return (
    <Link
      href="/"
      className="inline-flex min-h-11 items-center gap-2 rounded-md font-script text-2xl text-shef-orange focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-shef-navy"
    >
      <ChefHat />
      shefmeetschef
    </Link>
  );
}
