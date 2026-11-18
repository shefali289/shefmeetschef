/** "Winner" pill on the winning remix of a challenge. Text, not colour alone, carries the meaning. */
export default function WinnerBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-herb px-3 py-1 text-sm font-bold text-white">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-current">
        <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z" />
      </svg>
      Winner
    </span>
  );
}
