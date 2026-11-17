import { instagramCanonicalUrl, youtubeCanonicalUrl } from "@/lib/embed";
import { INSTAGRAM_URL } from "@/lib/social";

export interface RecipeActionsProps {
  reelUrl: string | null;
  youtubeUrl: string | null;
}


const base =
  "press inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2 font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cocoa";

function ExternalLink(props: { href: string; className: string; children: React.ReactNode }) {
  return (
    <a href={props.href} target="_blank" rel="noopener noreferrer" className={`${base} ${props.className}`}>
      {props.children}
    </a>
  );
}

export default function RecipeActions({ reelUrl, youtubeUrl }: RecipeActionsProps) {
  // Links are rebuilt from parsed ids, so only allow-listed hosts and no tracking params.
  const reel = reelUrl ? instagramCanonicalUrl(reelUrl) : null;
  const youtube = youtubeUrl ? youtubeCanonicalUrl(youtubeUrl) : null;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      {reel && (
        <ExternalLink href={reel} className="bg-copper text-white shadow-soft hover:bg-copper-dark">
          Watch the reel
        </ExternalLink>
      )}
      {youtube && (
        <ExternalLink href={youtube} className="bg-cocoa text-white shadow-soft hover:bg-cocoa-soft">
          Watch on YouTube
        </ExternalLink>
      )}
      <ExternalLink
        href={INSTAGRAM_URL}
        className="border-2 border-copper bg-white text-cocoa hover:bg-blush-light"
      >
        Follow @shefmeetschef
      </ExternalLink>
    </div>
  );
}
