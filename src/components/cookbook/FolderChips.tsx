import Link from "next/link";

export interface FolderChipsProps {
  folders: { id: string; name: string }[];
  /** Selected folder id from ?folder=, or null for All saves. */
  selected: string | null;
}

const chip =
  "press inline-flex min-h-11 items-center rounded-full px-4 font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper";
const chipOff = "bg-white text-cocoa ring-1 ring-cocoa/15 hover:bg-blush-light";
const chipOn = "bg-cocoa text-cream";

/** "All saves" plus one chip per folder, as shareable links. An unknown id selects All saves. */
export default function FolderChips({ folders, selected }: FolderChipsProps) {
  const current = folders.some((f) => f.id === selected) ? selected : null;
  const chips = [{ id: null as string | null, name: "All saves" }, ...folders];
  return (
    <ul className="flex flex-wrap gap-2">
      {chips.map((f) => (
        <li key={f.id ?? "all"}>
          <Link
            href={f.id ? `/cookbook?folder=${encodeURIComponent(f.id)}` : "/cookbook"}
            aria-current={f.id === current ? "page" : undefined}
            className={`${chip} ${f.id === current ? chipOn : chipOff}`}
          >
            {f.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
