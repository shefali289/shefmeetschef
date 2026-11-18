import { parseInstagramPost } from "@/lib/embed";

/** Instagram handle from a reel link like instagram.com/<handle>/reel/<id>/, or null. */
export function reelHandle(url: string | null | undefined): string | null {
  if (!url) return null;
  return parseInstagramPost(url)?.handle ?? null;
}

/** "From @handle's reel", or "From an outside reel" when the link has no handle. */
export function outsideReelLabel(url: string | null | undefined): string {
  const handle = reelHandle(url);
  return handle ? `From @${handle}'s reel` : "From an outside reel";
}
