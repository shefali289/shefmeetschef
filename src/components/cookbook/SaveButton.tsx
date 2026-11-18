"use client";
import Link from "next/link";
import { useActionState } from "react";
import { toggleSave, type CookbookActionState } from "@/app/cookbook/actions";
import HeartIcon from "./HeartIcon";
import SubmitButton from "./SubmitButton";
import { errorText } from "./styles";

export interface SaveButtonProps {
  recipeId: string;
  slug: string;
  saved: boolean;
  signedIn: boolean;
}

const heart =
  "press inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 font-bold shadow-soft focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cocoa";
const off = "bg-white text-copper-ink ring-2 ring-copper hover:bg-blush-light";
const on = "bg-copper text-white ring-2 ring-copper hover:bg-copper-dark";

/** "Save to my cookbook" heart. Signed-out visitors (or no Supabase) get a sign-in link instead. */
export default function SaveButton({ recipeId, slug, saved, signedIn }: SaveButtonProps) {
  const [state, formAction, pending] = useActionState<CookbookActionState, FormData>(toggleSave, { saved });
  const returnTo = `/recipes/${slug}`;

  if (!signedIn) {
    return (
      <Link href={`/sign-in?next=${encodeURIComponent(returnTo)}`} className={`${heart} ${off}`}>
        <HeartIcon filled={false} />
        Sign in to save
      </Link>
    );
  }

  const pressed = state.saved ?? saved;
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="recipe_id" value={recipeId} />
      <input type="hidden" name="intent" value={pressed ? "unsave" : "save"} />
      <input type="hidden" name="return_to" value={returnTo} />
      <SubmitButton pending={pending} aria-pressed={pressed} className={`${heart} ${pressed ? on : off}`}>
        <HeartIcon filled={pressed} />
        Save to my cookbook
      </SubmitButton>
      <p role="status" className="font-hand text-xl text-herb">
        {state.ok ? (pressed ? "Saved in your cookbook" : "Removed from your cookbook") : ""}
      </p>
      {state.error && (
        <p role="alert" className={errorText}>
          {state.error}
        </p>
      )}
    </form>
  );
}
