import { outsideReelLabel } from "@/lib/outside/handle";

/** "From @handle's reel" tag on a user's private outside recipe card. */
export default function OutsideTag({ reelUrl }: { reelUrl: string | null }) {
  return (
    <p className="font-hand text-2xl text-herb">
      {outsideReelLabel(reelUrl)}
      <span className="sr-only"> (only you can see this recipe)</span>
    </p>
  );
}
