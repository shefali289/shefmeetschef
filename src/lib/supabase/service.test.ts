import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
 * Contract (src/lib/supabase/service.ts, server-only): the ONLY place SUPABASE_SERVICE_ROLE_KEY is
 * read, and the only thing it can do is apply an AI verdict.
 *   applyAiVerdict(remixId, { verdict, reason }) -> Promise<"approved" | "pending" | "hidden" | null>
 * - Null (and no client made) without NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.
 * - Null without a call for a remix id that is not a uuid or a verdict that is not
 *   approve | review | reject.
 * - Otherwise creates a service client (createClient from @supabase/supabase-js, no session
 *   persistence) and calls ONLY rpc("apply_ai_verdict", { p_remix_id, p_verdict, p_reason }),
 *   returning the status it gives back. An rpc error, a thrown error or an unexpected value -> null.
 * - The module exports applyAiVerdict and nothing else (no raw client, no key).
 */

const REMIX = "33333333-3333-4333-8333-333333333333";
const URL_ = "https://abc.supabase.co";
const SERVICE_KEY = "test-service-role-key";

const { createClient, client } = vi.hoisted(() => {
  const client = {
    rpc: vi.fn(async (_fn: string, _args?: Record<string, unknown>) => ({ data: "approved" as unknown, error: null as unknown })),
    from: vi.fn(() => {
      throw new Error("service client must not touch tables");
    }),
    storage: { from: vi.fn(() => { throw new Error("service client must not touch storage"); }) },
    auth: { admin: {}, getUser: vi.fn() },
  };
  return { client, createClient: vi.fn((_url: string, _key: string, _opts?: unknown) => client) };
});
vi.mock("@supabase/supabase-js", () => ({ createClient }));

import * as service from "./service";
import { applyAiVerdict } from "./service";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  createClient.mockClear();
  client.rpc.mockReset();
  client.rpc.mockImplementation(async () => ({ data: "approved", error: null }));
  client.from.mockClear();
  client.storage.from.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("service-role path", () => {
  it("returns null without SUPABASE_SERVICE_ROLE_KEY", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(applyAiVerdict(REMIX, { verdict: "approve", reason: "ok" })).resolves.toBeNull();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await expect(applyAiVerdict(REMIX, { verdict: "approve", reason: "ok" })).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("applyAiVerdict calls only the apply_ai_verdict rpc", async () => {
    await expect(applyAiVerdict(REMIX, { verdict: "approve", reason: "A tasty dal" })).resolves.toBe("approved");
    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key, opts] = createClient.mock.calls[0];
    expect(url).toBe(URL_);
    expect(key).toBe(SERVICE_KEY);
    expect((opts as { auth?: { persistSession?: boolean } } | undefined)?.auth?.persistSession).toBe(false);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("apply_ai_verdict", { p_remix_id: REMIX, p_verdict: "approve", p_reason: "A tasty dal" });
    expect(client.from).not.toHaveBeenCalled();
    expect(client.storage.from).not.toHaveBeenCalled();

    client.rpc.mockImplementation(async () => ({ data: "hidden", error: null }));
    await expect(applyAiVerdict(REMIX, { verdict: "reject", reason: "Not food" })).resolves.toBe("hidden");
    client.rpc.mockImplementation(async () => ({ data: "pending", error: null }));
    await expect(applyAiVerdict(REMIX, { verdict: "review", reason: "Unsure" })).resolves.toBe("pending");
  });

  it("a failed or odd rpc result is null, never a throw", async () => {
    client.rpc.mockImplementation(async () => ({ data: null, error: { message: "permission denied", code: "42501" } }));
    await expect(applyAiVerdict(REMIX, { verdict: "approve", reason: "ok" })).resolves.toBeNull();
    client.rpc.mockImplementation(async () => {
      throw new Error("fetch failed");
    });
    await expect(applyAiVerdict(REMIX, { verdict: "approve", reason: "ok" })).resolves.toBeNull();
    client.rpc.mockImplementation(async () => ({ data: null, error: null })); // already checked
    await expect(applyAiVerdict(REMIX, { verdict: "approve", reason: "ok" })).resolves.toBeNull();
    client.rpc.mockImplementation(async () => ({ data: "<script>", error: null }));
    await expect(applyAiVerdict(REMIX, { verdict: "approve", reason: "ok" })).resolves.toBeNull();
  });

  it("refuses bad input without calling Supabase", async () => {
    await expect(applyAiVerdict("not-a-uuid", { verdict: "approve", reason: "ok" })).resolves.toBeNull();
    await expect(applyAiVerdict(`${REMIX}' or 1=1`, { verdict: "approve", reason: "ok" })).resolves.toBeNull();
    await expect(
      applyAiVerdict(REMIX, { verdict: "publish" as unknown as "approve", reason: "ok" }),
    ).resolves.toBeNull();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("exports no raw client", () => {
    expect(Object.keys(service).sort()).toEqual(["applyAiVerdict"]);
    expect(typeof service.applyAiVerdict).toBe("function");
  });
});
