/** Warm illustrated stand-in for a recipe without a photo: chef hat and herb sprig on cream-peach. */
export default function RecipePlaceholder({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="recipe-placeholder"
      className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-cream via-peach-light to-peach ${className}`}
    >
      <svg viewBox="0 0 160 120" focusable="false" className="h-3/4 w-3/4 max-w-56">
        {/* blush brush stroke */}
        <path
          d="M22 88c22-8 52-12 82-10 14 1 26 3 36 6-8 6-30 9-54 9-26 0-48-1-64-5Z"
          className="fill-blush"
          opacity=".7"
        />
        {/* chef hat */}
        <g transform="translate(50 18)" strokeWidth="2" strokeLinejoin="round" className="stroke-cocoa">
          <path d="M14 46V40A12 12 0 0 1 12 17 17 17 0 0 1 44 14 12 12 0 0 1 46 40v6Z" className="fill-white" />
          <path
            d="M22 27c1 6 1 11 0 15M30 22c1 8 1 14 0 20M38 27c-1 6-1 11 0 15"
            fill="none"
            strokeLinecap="round"
            className="stroke-peach"
          />
          <rect x="13" y="46" width="34" height="12" rx="3" className="fill-white" />
          <path d="M13 50h34" strokeWidth="2.5" className="stroke-blush" />
        </g>
        {/* herb sprig */}
        <g transform="translate(104 34) rotate(18)" className="fill-herb text-herb">
          <path d="M6 54C10 36 12 20 22 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M9 40c-6-2-9-7-8-12 5 1 9 5 8 12Z" />
          <path d="M10 40c2-6 6-9 11-9 0 5-4 9-11 9Z" opacity=".8" />
          <path d="M14 24c-6-2-8-7-7-11 5 1 8 5 7 11Z" />
          <path d="M15 24c2-5 6-8 10-8 0 5-4 8-10 8Z" opacity=".8" />
        </g>
        {/* little heart and sparkles */}
        <g className="text-copper" opacity=".55">
          <path d="M34 40s-7-4-7-8a3.5 3.5 0 0 1 7-1 3.5 3.5 0 0 1 7 1c0 4-7 8-7 8Z" fill="currentColor" />
          <path d="M128 22v8M124 26h8M24 64v6M21 67h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}
