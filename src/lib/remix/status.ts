// Client-safe remix copy.
import type { HiddenBy, RemixStatus } from "./types";

/** Shown wherever remixes need Supabase and it is not set up. */
export const REMIX_NOT_CONFIGURED = "Remixes are not set up yet. Check back soon!";

const LABELS: Record<RemixStatus, string> = {
  approved: "Live",
  pending: "Waiting for a quick check",
  hidden: "Hidden",
};

/**
 * The owner's status text. A hidden remix says why when the AI hid it ("Hidden: <reason>") or
 * reports did ("Hidden while Shef takes a look"). The AI's reason is never shown otherwise.
 */
export function statusLabel(
  status: RemixStatus,
  moderation?: { hiddenBy?: HiddenBy | null; aiReason?: string | null },
): string {
  if (status === "hidden") {
    const reason = moderation?.aiReason?.trim();
    if (moderation?.hiddenBy === "ai" && reason) return `Hidden: ${reason}`;
    if (moderation?.hiddenBy === "reports") return "Hidden while Shef takes a look";
  }
  return LABELS[status];
}
