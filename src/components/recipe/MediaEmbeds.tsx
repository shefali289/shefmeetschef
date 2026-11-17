import { instagramEmbedUrl, youtubeEmbedId } from "@/lib/embed";

export interface MediaEmbedsProps {
  title: string;
  reelUrl: string | null;
  youtubeUrl: string | null;
}

// No allow-top-navigation: embeds cannot redirect the page.
const SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation";

/** Instagram and YouTube players, built only from parsed, allow-listed ids. */
export default function MediaEmbeds({ title, reelUrl, youtubeUrl }: MediaEmbedsProps) {
  const instagram = reelUrl ? instagramEmbedUrl(reelUrl) : null;
  const youtubeId = youtubeUrl ? youtubeEmbedId(youtubeUrl) : null;
  if (!instagram && !youtubeId) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {instagram && (
        <iframe
          src={instagram}
          title={`Instagram reel: ${title}`}
          loading="lazy"
          sandbox={SANDBOX}
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          className="mx-auto h-[620px] w-full max-w-[400px] rounded-xl border border-shef-navy/10 bg-white"
        />
      )}
      {youtubeId && (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
          title={`YouTube video: ${title}`}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          sandbox={SANDBOX}
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          className="aspect-video w-full rounded-xl bg-shef-navy"
        />
      )}
    </div>
  );
}
