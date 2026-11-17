/** Small decorative herb accent. Hidden from assistive tech. */
export default function HerbSprig({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      className={`h-10 w-10 text-herb ${className}`}
    >
      <path d="M8 42C20 30 28 20 40 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18 31c-6-1-9-5-9-9 5 0 9 3 9 9Z" fill="currentColor" />
      <path d="M18 31c1-6 5-9 9-9 0 5-3 9-9 9Z" fill="currentColor" opacity=".8" />
      <path d="M28 19c-6-1-9-5-9-9 5 0 9 3 9 9Z" fill="currentColor" />
      <path d="M28 19c1-6 5-9 9-9 0 5-3 9-9 9Z" fill="currentColor" opacity=".8" />
    </svg>
  );
}
