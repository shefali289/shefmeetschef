import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
 * Contract (src/app/remixes/report-actions.ts, "use server"):
 *   reportRemix(prev: ReportState, formData{ remix_id, reason?, return_to? }) -> ReportState
 *     ReportState = { ok?: boolean; message?: string; error?: string }
 *   - insert into `remix_reports` with the signed-in user's own session (RLS decides: approved,
 *     not your own, not banned), with { remix_id, reason }: reason trimmed, cut to 300 characters,
 *     blank -> null. user_id, if sent at all, is the session user. Nothing else is written.
 *   - 23505 (already reported) -> { ok: true, message: "...already reported..." }.
 *   - Any other error (42501 refused, network) -> { error: friendly text } (never the raw message).
 *   - remix_id must be a uuid (no table touched otherwise).
 *   - Signed out -> redirect /sign-in?next=<return_to if same-site, else /remixes>.
 *   - Not configured -> { error: "...not set up yet..." }.
 *   - Success -> { ok: true, message: "Reported, thanks..." } and revalidates /remixes and the
 *     recipe page the report came from (the third report hides the remix).
 */

type Op = { table: string; method: string; payload?: unknown };
const state: {
  ops: Op[];
  user: { id: string; email: string } | null;
  error: { code?: string; message: string } | null;
} = { ops: [], user: null, error: null };

function makeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    storage: { from: vi.fn() },
    from: vi.fn((table: string) => {
      const op: Op = { table, method: "select" };
      state.ops.push(op);
      const result = () => (state.error && op.method !== "select" ? { data: null, error: state.error } : { data: [], error: null });
      const b: Record<string, unknown> = {};
      for (const m of ["insert", "update", "delete", "upsert"]) {
        b[m] = (payload?: unknown) => {
          op.method = m;
          op.payload = payload;
          return b;
        };
      }
      for (const f of ["select", "eq", "neq", "is", "in", "match", "filter"]) b[f] = () => b;
      b.maybeSingle = async () => result();
      b.single = b.maybeSingle;
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return b;
    }),
  };
}

const { createSupabaseServerClient } = vi.hoisted(() => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  }),
}));

import { revalidatePath } from "next/cache";
import { reportRemix } from "./report-actions";

const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const REMIX = "33333333-3333-4333-8333-333333333333";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const writes = () => state.ops.filter((o) => o.method !== "select");
const inserted = () => {
  const w = writes();
  expect(w).toHaveLength(1);
  expect(w[0]).toMatchObject({ table: "remix_reports", method: "insert" });
  const p = (Array.isArray(w[0].payload) ? w[0].payload[0] : w[0].payload) as Record<string, unknown>;
  return p;
};

beforeEach(() => {
  state.ops = [];
  state.user = USER;
  state.error = null;
  createSupabaseServerClient.mockReset();
  createSupabaseServerClient.mockImplementation(async () => makeClient());
  vi.mocked(revalidatePath).mockClear();
});

describe("reportRemix", () => {
  it("reportRemix inserts with the user's client and a reason trimmed to 300", async () => {
    const res = await reportRemix({}, form({ remix_id: REMIX, reason: `   ${"r".repeat(400)}   `, return_to: "/recipes/masala-chai" }));
    expect(res).toMatchObject({ ok: true, message: expect.stringMatching(/reported, thanks/i) });
    expect(createSupabaseServerClient).toHaveBeenCalled();
    const p = inserted();
    expect(p.remix_id).toBe(REMIX);
    expect(p.reason).toBe("r".repeat(300));
    if ("user_id" in p) expect(p.user_id).toBe(USER.id);
    expect(Object.keys(p).sort()).toEqual(expect.arrayContaining(["reason", "remix_id"]));
    for (const k of Object.keys(p)) expect(["remix_id", "reason", "user_id"]).toContain(k);
    expect(revalidatePath).toHaveBeenCalledWith("/remixes");
    expect(revalidatePath).toHaveBeenCalledWith("/recipes/masala-chai");
  });

  it("the reason is optional and a blank reason is null", async () => {
    await reportRemix({}, form({ remix_id: REMIX }));
    expect(inserted().reason ?? null).toBeNull();
    state.ops = [];
    await reportRemix({}, form({ remix_id: REMIX, reason: "   \n " }));
    expect(inserted().reason ?? null).toBeNull();
  });

  it("a duplicate says you already reported it", async () => {
    state.error = { code: "23505", message: 'duplicate key value violates unique constraint "remix_reports_pkey"' };
    const res = await reportRemix({}, form({ remix_id: REMIX }));
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/already reported/i);
    expect(res.error).toBeUndefined();
  });

  it("a refused report returns a friendly error", async () => {
    for (const error of [
      { code: "42501", message: 'new row violates row-level security policy for table "remix_reports"' },
      { code: "XX000", message: "connection reset" },
    ]) {
      state.ops = [];
      state.error = error;
      const res = await reportRemix({}, form({ remix_id: REMIX }));
      expect(res.ok).toBeFalsy();
      expect(res.error).toEqual(expect.any(String));
      expect(res.error).not.toMatch(/row-level|policy|connection reset|remix_reports/);
    }
  });

  it("remix_id must be a uuid", async () => {
    for (const bad of ["", "abc", `${REMIX}'; drop table remix_reports; --`]) {
      state.ops = [];
      const res = await reportRemix({}, form({ remix_id: bad }));
      expect(res.error).toEqual(expect.any(String));
      expect(writes()).toEqual([]);
    }
  });

  it("signed-out redirects to sign-in", async () => {
    state.user = null;
    await expect(reportRemix({}, form({ remix_id: REMIX, return_to: "/recipes/masala-chai" }))).rejects.toThrow(
      "NEXT_REDIRECT /sign-in?next=%2Frecipes%2Fmasala-chai",
    );
    // an off-site return path falls back to a same-site page
    const off = (await reportRemix({}, form({ remix_id: REMIX, return_to: "https://evil.example/" })).catch(
      (e: unknown) => e,
    )) as { digest?: string };
    const next = new URLSearchParams(String(off.digest).split("?")[1]).get("next") ?? "";
    expect(next.startsWith("/")).toBe(true);
    expect(next).not.toContain("evil.example");
    // no return path at all goes back to /remixes
    await expect(reportRemix({}, form({ remix_id: REMIX }))).rejects.toThrow("NEXT_REDIRECT /sign-in?next=%2Fremixes");
    expect(writes()).toEqual([]);
  });

  it("not configured says not set up yet", async () => {
    createSupabaseServerClient.mockImplementation(async () => null);
    const res = await reportRemix({}, form({ remix_id: REMIX }));
    expect(res.error).toMatch(/not set up yet/i);
  });
});
