import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { consumeUsage, LimitReachedError, limitReachedError, usageRemaining } from "./usage";

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

  /* ---------- task 3 slice B: remixes ---------- */
  it("remix limit maps to LimitReachedError", async () => {
    // through the usage rpcs (the remix counter reads usage_remaining('remix', 5))
    const { client, rpc } = fakeClient({ data: null, error: { message: "usage_limit_reached", code: "SMU01" } });
    const err = await usageRemaining(client, "remix", 5).catch((e: unknown) => e);
    expect(rpc).toHaveBeenCalledWith("usage_remaining", { kind: "remix", lim: 5 });
    expect(err).toBeInstanceOf(LimitReachedError);
    expect(err).toMatchObject({ kind: "remix", limit: 5, remaining: 0 });

    // and from a failed remix insert (the before-insert trigger spends the remix and raises)
    for (const error of [
      { code: "SMU01", message: "usage_limit_reached" },
      { code: "P0001", message: "usage_limit_reached: remix" },
    ]) {
      const mapped = limitReachedError(error, "remix", 5);
      expect(mapped).toBeInstanceOf(LimitReachedError);
      expect(mapped).toMatchObject({ kind: "remix", limit: 5, remaining: 0 });
    }
    for (const error of [
      null,
      { code: "42501", message: "new row violates row-level security policy for table \"remixes\"" },
      { code: "23505", message: "duplicate key value violates unique constraint" },
    ]) {
      expect(limitReachedError(error, "remix", 5)).toBeNull();
    }
  });
});
