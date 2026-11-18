import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
 * Contract (src/app/cookbook/reel-actions.ts, "use server"):
 *   deleteReel(prev, formData{ recipe_id }) -> Promise<{ ok?, error? }>
 * - Deletes only the signed-in user's own outside recipe: filters id, source = 'outside' and
 *   owner_id = the session user (never a client-supplied owner). RLS enforces it again.
 * - recipe_id must be a uuid; bad input touches no table.
 * - Nothing deleted (not theirs, not outside, already gone) returns { error }.
 * - No refund: never touches `usage` or calls an rpc.
 * - Signed out: redirect to /sign-in?next=%2Fcookbook. Not configured: { error: "...not set up yet..." }.
 * - Success revalidates /cookbook.
 */

type Op = { table: string; method: string; payload?: unknown; filters: [string, string, unknown][] };

const state: {
  ops: Op[];
  user: { id: string; email: string } | null;
  configured: boolean;
  deleted: unknown[];
  error: { code?: string; message: string } | null;
} = { ops: [], user: null, configured: true, deleted: [], error: null };

const rpc = vi.fn(async () => ({ data: null, error: null }));

function makeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    rpc,
    from: vi.fn((table: string) => {
      const op: Op = { table, method: "select", filters: [] };
      state.ops.push(op);
      const result = () => ({ data: state.error ? null : op.method === "delete" ? state.deleted : [], error: state.error });
      const b: Record<string, unknown> = {};
      for (const m of ["insert", "update", "delete", "upsert"]) {
        b[m] = (payload?: unknown) => {
          op.method = m;
          op.payload = payload;
          return b;
        };
      }
      b.select = () => b;
      for (const f of ["eq", "neq", "is", "in", "match", "filter"]) {
        b[f] = (col: string, val?: unknown) => {
          op.filters.push([f, col, val]);
          return b;
        };
      }
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
import { redirect } from "next/navigation";
import { deleteReel } from "./reel-actions";

const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const RECIPE = "11111111-1111-4111-8111-111111111111";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  state.ops = [];
  state.user = USER;
  state.configured = true;
  state.deleted = [{ id: RECIPE }];
  state.error = null;
  rpc.mockClear();
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(redirect).mockClear();
  createSupabaseServerClient.mockReset();
  createSupabaseServerClient.mockImplementation(async () => (state.configured ? makeClient() : null));
});

describe("deleteReel", () => {
  it("deletes only the user's own outside recipe", async () => {
    const res = await deleteReel({}, form({ recipe_id: RECIPE, owner_id: "c0000000-0000-4000-8000-000000000009" }));
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    const writes = state.ops.filter((o) => o.method !== "select");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ table: "recipes", method: "delete" });
    expect(writes[0].filters).toEqual(
      expect.arrayContaining([
        ["eq", "id", RECIPE],
        ["eq", "source", "outside"],
        ["eq", "owner_id", USER.id],
      ]),
    );
    // The owner filter is the session user, never the client-supplied one.
    expect(writes[0].filters.filter(([, col]) => col === "owner_id")).toEqual([["eq", "owner_id", USER.id]]);
    expect(revalidatePath).toHaveBeenCalledWith("/cookbook");
  });

  it("gives no reel back (never touches usage)", async () => {
    await deleteReel({}, form({ recipe_id: RECIPE }));
    expect(rpc).not.toHaveBeenCalled();
    expect(state.ops.map((o) => o.table)).not.toContain("usage");
  });

  it("returns an error when nothing was deleted (not theirs or not an outside recipe)", async () => {
    state.deleted = [];
    const res = await deleteReel({}, form({ recipe_id: RECIPE }));
    expect(res.error).toBeTruthy();
    expect(res.ok).toBeUndefined();
  });

  it("returns a friendly message on a database error", async () => {
    state.error = { code: "42501", message: "permission denied for table recipes" };
    const res = await deleteReel({}, form({ recipe_id: RECIPE }));
    expect(res.error).toBeTruthy();
    expect(res.error).not.toMatch(/permission denied/);
  });

  it("rejects a non-uuid id without touching the database", async () => {
    for (const id of ["", "nope", "1; drop table recipes"]) {
      const res = await deleteReel({}, form({ recipe_id: id }));
      expect(res.error).toBeTruthy();
    }
    expect(state.ops).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("redirects signed-out users to sign-in", async () => {
    state.user = null;
    const err = (await deleteReel({}, form({ recipe_id: RECIPE })).catch((e: unknown) => e)) as { digest?: string };
    expect(err.digest).toBe(`NEXT_REDIRECT;/sign-in?next=${encodeURIComponent("/cookbook")}`);
    expect(state.ops.filter((o) => o.method !== "select")).toEqual([]);
  });

  it("not configured returns not set up yet", async () => {
    state.configured = false;
    const res = await deleteReel({}, form({ recipe_id: RECIPE }));
    expect(res.error).toMatch(/not set up yet/i);
    expect(redirect).not.toHaveBeenCalled();
  });
});
