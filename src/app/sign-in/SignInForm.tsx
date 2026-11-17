"use client";

import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

const button =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full px-6 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shef-orange disabled:opacity-60";

function callbackUrl(next: string): string {
  const url = new URL("/auth/callback", window.location.origin);
  url.searchParams.set("next", next);
  return url.href;
}

/** Google sign-in and email magic link. `next` is already checked by safeNext on the server. */
export default function SignInForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function google() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl(next) },
    });
    if (error) setStatus({ kind: "error", message: "Could not start Google sign-in. Please try again." });
  }

  async function magicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setStatus({ kind: "sending" });
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl(next) },
    });
    setStatus(
      error
        ? { kind: "error", message: "Could not send the link. Check the address and try again." }
        : { kind: "sent" },
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <button type="button" onClick={google} className={`${button} bg-shef-orange text-white hover:bg-shef-orange-dark`}>
        Continue with Google
      </button>

      <form onSubmit={magicLink} className="space-y-3">
        <label htmlFor="sign-in-email" className="block font-semibold">
          Or get a sign-in link by email
        </label>
        <input
          id="sign-in-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="block min-h-11 w-full rounded-lg border border-shef-navy/30 bg-white px-3 focus-visible:outline-2 focus-visible:outline-shef-orange"
        />
        <button
          type="submit"
          disabled={status.kind === "sending"}
          className={`${button} border-2 border-shef-orange text-shef-orange hover:bg-shef-orange/10`}
        >
          {status.kind === "sending" ? "Sending…" : "Email me a link"}
        </button>
      </form>

      <p aria-live="polite" className="min-h-6">
        {status.kind === "sent" && "Check your inbox for the sign-in link."}
        {status.kind === "error" && status.message}
      </p>
    </div>
  );
}
