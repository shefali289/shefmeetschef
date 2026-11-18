// The one service-role call: apply_ai_verdict. The only place SUPABASE_SERVICE_ROLE_KEY is read.
// It bypasses RLS, so no client or key ever leaves this module.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { ModerationVerdict, RemixStatus } from "@/lib/remix/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERDICTS = new Set(["approve", "review", "reject"]);
const STATUSES = new Set<RemixStatus>(["approved", "pending", "hidden"]);
/** The verdict call runs after Gemini inside one server action, so it gets a short timeout. */
const SERVICE_TIMEOUT_MS = 3000;

/**
 * Applies the AI verdict to a pending, unchecked remix. The status after it, or null when the
 * service key is missing, the input is bad, the call failed or the database did nothing.
 */
export async function applyAiVerdict(remixId: string, verdict: ModerationVerdict): Promise<RemixStatus | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !UUID_RE.test(remixId) || !VERDICTS.has(verdict.verdict)) return null;

  try {
    const service = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS) }) },
    });
    const { data, error } = await service.rpc("apply_ai_verdict", {
      p_remix_id: remixId,
      p_verdict: verdict.verdict,
      p_reason: verdict.reason,
    });
    return !error && STATUSES.has(data as RemixStatus) ? (data as RemixStatus) : null;
  } catch {
    return null;
  }
}
