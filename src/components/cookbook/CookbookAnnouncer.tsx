"use client";
import { useEffect, useState } from "react";

// One status region per page. Controls announce through a module-level channel rather than
// their own regions, so the message survives the control being removed (e.g. a deleted card).
type Listener = (message: string) => void;
const listeners = new Set<Listener>();

/** Says `message` in the cookbook status region, if one is mounted. */
export function announce(message: string): void {
  for (const listener of listeners) listener(message);
}

/** Announces `message` each time an action returns `{ ok: true }`. */
export function useAnnounceOnSuccess(state: { ok?: boolean }, message: string): void {
  useEffect(() => {
    if (state.ok) announce(message);
  }, [state, message]);
}

/** The persistent role="status" region for /cookbook. Mount it once, outside lists and cards. */
export default function CookbookAnnouncer() {
  const [said, setSaid] = useState({ text: "", count: 0 });

  useEffect(() => {
    const listener: Listener = (text) => setSaid((prev) => ({ text, count: prev.count + 1 }));
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <p role="status" className="font-semibold text-herb">
      {said.text}
      {/* A changing invisible suffix so the same message twice in a row is read again. */}
      {said.count % 2 === 1 ? " " : ""}
    </p>
  );
}
