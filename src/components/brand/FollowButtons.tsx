import { INSTAGRAM_URL, YOUTUBE_URL } from "@/lib/social";
import { InstagramIcon, YouTubeIcon } from "./SocialIcons";

const base =
  "press inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2 font-bold focus-visible:outline-3 focus-visible:outline-offset-2";

/** Instagram and YouTube follow links. `tone` picks colours for a light or dark background. */
export default function FollowButtons({
  tone = "light",
  className = "",
}: {
  tone?: "light" | "dark";
  className?: string;
}) {
  const instagram =
    tone === "light"
      ? "bg-copper text-white shadow-soft hover:bg-copper-dark focus-visible:outline-cocoa"
      : "bg-cream text-cocoa hover:bg-blush-light focus-visible:outline-cream";
  const youtube =
    tone === "light"
      ? "border-2 border-cocoa bg-white text-cocoa hover:bg-blush-light focus-visible:outline-cocoa"
      : "border-2 border-cream text-cream hover:bg-cream/10 focus-visible:outline-cream";
  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className={`${base} ${instagram}`}>
        <InstagramIcon />
        Instagram<span className="sr-only"> (opens in new tab)</span>
      </a>
      <a href={YOUTUBE_URL} target="_blank" rel="noopener noreferrer" className={`${base} ${youtube}`}>
        <YouTubeIcon />
        YouTube<span className="sr-only"> (opens in new tab)</span>
      </a>
    </div>
  );
}
