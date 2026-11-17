/** First focusable element on every page; jumps keyboard users past the header. */
export default function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-full bg-shef-navy px-5 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-shef-orange"
    >
      Skip to content
    </a>
  );
}
