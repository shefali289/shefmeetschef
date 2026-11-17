import type { SupabaseClient } from "@supabase/supabase-js";

export type UsageKind = "ask" | "outside_reel";

/** The user has used up this period's allowance. */
export class LimitReachedError extends Error {
  kind: UsageKind;
  limit: number;
  remaining = 0 as const;
  constructor(kind: UsageKind, limit: number) {
    super(`usage_limit_reached: ${kind}`);
    this.name = "LimitReachedError";
    this.kind = kind;
    this.limit = limit;
  }
}

type RpcError = { message: string; code?: string } | null;

async function callUsage(
  supabase: SupabaseClient,
  fn: "consume_usage" | "usage_remaining",
  kind: UsageKind,
  limit: number,
): Promise<number> {
  const { data, error } = (await supabase.rpc(fn, { kind, lim: limit })) as {
    data: unknown;
    error: RpcError;
  };
  if (error) {
    // consume_usage raises 'usage_limit_reached' (SQLSTATE SMU01) when no use is left.
    if (error.code === "SMU01" || /usage_limit_reached/.test(error.message)) {
      throw new LimitReachedError(kind, limit);
    }
    throw new Error(`${fn} failed: ${error.message}`);
  }
  if (typeof data !== "number" || !Number.isFinite(data)) {
    throw new Error(`${fn} returned an unexpected result`);
  }
  return data;
}

/** Calls consume_usage; returns how many are left after this use. Throws LimitReachedError. */
export async function consumeUsage(
  supabase: SupabaseClient,
  kind: UsageKind,
  limit: number,
): Promise<number> {
  return callUsage(supabase, "consume_usage", kind, limit);
}

/** Calls usage_remaining (read-only). */
export async function usageRemaining(
  supabase: SupabaseClient,
  kind: UsageKind,
  limit: number,
): Promise<number> {
  return callUsage(supabase, "usage_remaining", kind, limit);
}
