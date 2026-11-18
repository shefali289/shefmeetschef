"use client";
import Link from "next/link";
import { useOptimistic, useState } from "react";
import { toggleLike } from "@/app/remixes/actions";
import HeartIcon from "@/components/cookbook/HeartIcon";
import SubmitButton from "@/components/cookbook/SubmitButton";
import { errorText } from "@/components/cookbook/styles";

export interface LikeButtonProps {
  remixId: string;
  authorName: string;
  count: number;
  liked: boolean;
  signedIn: boolean;
  /** Where the sign-in link sends the visitor back to. */
  returnTo: string;
}

const heart =
  "press inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cocoa";
const off = "bg-white text-copper-ink ring-2 ring-copper hover:bg-blush-light";
const on = "bg-copper text-white ring-2 ring-copper hover:bg-copper-dark";

const likesText = (n: number) => `${n} ${n === 1 ? "like" : "likes"}`;

/** Heart on an approved remix. The press and count change at once and settle on the server's answer. */
export default function LikeButton({ remixId, authorName, count, liked, signedIn, returnTo }: LikeButtonProps) {
  const [current, setCurrent] = useState(liked);
  const [shown, setShown] = useOptimistic(current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `count` includes the viewer's like as the server last saw it.
  const total = Math.max(0, count + (shown ? 1 : 0) - (liked ? 1 : 0));

  if (!signedIn) {
    return (
      <Link
        href={`/sign-in?next=${encodeURIComponent(returnTo)}`}
        aria-label={`Sign in to like ${authorName}'s remix, ${likesText(count)}`}
        className={`${heart} ${off}`}
      >
        <HeartIcon filled={false} />
        {count}
      </Link>
    );
  }

  async function act(formData: FormData) {
    setPending(true);
    setShown(!current);
    setError(null);
    const res = await toggleLike({}, formData);
    if (typeof res.liked === "boolean") setCurrent(res.liked);
    setError(res.error ?? null);
    setPending(false);
  }

  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="remix_id" value={remixId} />
      <input type="hidden" name="intent" value={shown ? "unlike" : "like"} />
      <input type="hidden" name="return_to" value={returnTo} />
      <SubmitButton
        pending={pending}
        aria-pressed={shown}
        aria-label={`Like ${authorName}'s remix, ${likesText(total)}`}
        className={`${heart} ${shown ? on : off}`}
      >
        <HeartIcon filled={shown} />
        {total}
      </SubmitButton>
      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}
    </form>
  );
}
