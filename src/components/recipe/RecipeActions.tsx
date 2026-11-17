import { instagramCanonicalUrl, youtubeCanonicalUrl } from "@/lib/embed";

export interface RecipeActionsProps {
  reelUrl: string | null;
  youtubeUrl: string | null;
}

const FOLLOW_URL = "https://www.instagram.com/shefmeetschef/";

const base =
  "inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2 font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-shef-navy";

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
        <ExternalLink href={reel} className="bg-shef-orange text-white hover:bg-shef-orange-dark">
          Watch the reel
        </ExternalLink>
      )}
      {youtube && (
        <ExternalLink href={youtube} className="bg-shef-navy text-white hover:opacity-90">
          Watch on YouTube
        </ExternalLink>
      )}
      <ExternalLink
        href={FOLLOW_URL}
        className="border-2 border-shef-orange bg-white text-shef-navy hover:bg-shef-cream"
      >
        Follow @shefmeetschef
      </ExternalLink>
    </div>
  );
}
