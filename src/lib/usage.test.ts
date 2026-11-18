import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { consumeUsage, LimitReachedError, usageRemaining } from "./usage";

/*
 * Contract: consumeUsage(supabase, kind, limit) calls
 *   supabase.rpc("consume_usage", { kind, lim: limit }) and returns the remaining count.
 * The DB raises with message "usage_limit_reached" (custom SQLSTATE) when over the limit;
 * that becomes LimitReachedError { kind, limit, remaining: 0 }.
 * usageRemaining calls supabase.rpc("usage_remaining", { kind, lim: limit }).
 */
function fakeClient(result: { data: unknown; error: { message: string; code?: string } | null }) {
  const rpc = vi.fn(async (_fn: string, _args?: Record<string, unknown>) => result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("usage", () => {
  it("consumeUsage returns remaining", async () => {
    const { client, rpc } = fakeClient({ data: 7, error: null });
    await expect(consumeUsage(client, "ask", 10)).resolves.toBe(7);
    expect(rpc).toHaveBeenCalledWith("consume_usage", { kind: "ask", lim: 10 });

    const reels = fakeClient({ data: 0, error: null });
    await expect(consumeUsage(reels.client, "outside_reel", 5)).resolves.toBe(0);
    expect(reels.rpc).toHaveBeenCalledWith("consume_usage", { kind: "outside_reel", lim: 5 });
  });

  it("usage_limit_reached becomes LimitReachedError with 0 left", async () => {
    const { client } = fakeClient({
      data: null,
      error: { message: "usage_limit_reached", code: "P0001" },
    });
    const err = await consumeUsage(client, "ask", 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LimitReachedError);
    expect(err).toMatchObject({ kind: "ask", limit: 10, remaining: 0 });
  });

  it("other errors are rethrown", async () => {
    const { client } = fakeClient({ data: null, error: { message: "permission denied", code: "42501" } });
    const err = await consumeUsage(client, "ask", 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LimitReachedError);
    expect(String((err as Error).message)).toMatch(/permission denied/);

    // a non-numeric result is not silently treated as "remaining"
    const weird = fakeClient({ data: "lots", error: null });
    await expect(consumeUsage(weird.client, "ask", 10)).rejects.toThrow();
  });

  it("usageRemaining reads without consuming", async () => {
    const { client, rpc } = fakeClient({ data: 3, error: null });
    await expect(usageRemaining(client, "outside_reel", 5)).resolves.toBe(3);
    expect(rpc).toHaveBeenCalledWith("usage_remaining", { kind: "outside_reel", lim: 5 });
    expect(rpc).not.toHaveBeenCalledWith("consume_usage", expect.anything());
  });
});
