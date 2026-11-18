// Client-safe remix copy.
import type { RemixStatus } from "./types";

/** Shown wherever remixes need Supabase and it is not set up. */
export const REMIX_NOT_CONFIGURED = "Remixes are not set up yet. Check back soon!";

const LABELS: Record<RemixStatus, string> = {
  approved: "Live",
  pending: "Waiting for a quick check",
  hidden: "Hidden",
};

export function statusLabel(status: RemixStatus): string {
  return LABELS[status];
}
