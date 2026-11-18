import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
 * Contract (src/app/remixes/actions.ts, "use server"):
 *   toggleLike(prev, formData{ remix_id, intent: "like" | "unlike", return_to? }) -> LikeState
 *   - like: insert into `likes` with the user's session, only { remix_id } (user_id, if sent at
 *     all, is the session user; RLS checks the remix is public). 23505 (already liked) counts as
 *     liked. A refused like (42501: pending, hidden, banned) returns a friendly error, liked false.
 *   - unlike: delete from `likes` where remix_id and user_id = the session user.
 *   deleteRemix(prev, formData{ remix_id }) -> { ok?, error? }
 *   - deletes from `remixes` with the user's session, filtered by id and user_id = session user,
 *     returning the row; THEN removes that row's photo_path (never a client-sent path) from
 *     remix-photos. Nothing deleted: "couldn't find" error and no Storage call. No usage refund.
 *   Both: remix_id must be a uuid (no table touched otherwise); signed out redirects to
 *   /sign-in?next=<return_to if same-site, else /remixes>; not configured says not set up yet;
 *   success revalidates /remixes.
 */

type Op = { table: string; method: string; payload?: unknown; filters: [string, string, unknown][] };
type StorageOp = { bucket: string; method: string; args: unknown[] };

const state: {
  ops: Op[];
  storage: StorageOp[];
  order: string[];
  user: { id: string; email: string } | null;
  configured: boolean;
  deleted: unknown[];
  error: { code?: string; message: string } | null;
} = { ops: [], storage: [], order: [], user: null, configured: true, deleted: [], error: null };

const rpc = vi.fn(async () => ({ data: null, error: null }));

function makeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    rpc,
    storage: {
      from: (bucket: string) => ({
        remove: vi.fn(async (paths: string[]) => {
          state.storage.push({ bucket, method: "remove", args: [paths] });
          state.order.push("storage.remove");
          return { data: paths.map((name) => ({ name })), error: null };
        }),
      }),
    },
    from: vi.fn((table: string) => {
      const op: Op = { table, method: "select", filters: [] };
      state.ops.push(op);
      const result = () => {
        state.order.push(`${table}.${op.method}`);
        if (state.error) return { data: null, error: state.error };
        return { data: op.method === "delete" ? state.deleted : op.method === "insert" ? [{}] : [], error: null };
      };
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
      b.maybeSingle = async () => {
        const r = result();
        return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data };
      };
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
import { redirect } from "next/navigation";
import { deleteRemix, toggleLike } from "./actions";

const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const OTHER = "c0000000-0000-4000-8000-000000000003";
const REMIX = "33333333-3333-4333-8333-333333333333";
const PHOTO = `${USER.id}/0f8fad5b-d9cb-469f-a165-70867728950e.jpg`;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const writes = () => state.ops.filter((o) => o.method !== "select");

beforeEach(() => {
  state.ops = [];
  state.storage = [];
  state.order = [];
  state.user = USER;
  state.configured = true;
  state.deleted = [{ id: REMIX, photo_path: PHOTO, recipe_id: "11111111-1111-4111-8111-111111111111" }];
  state.error = null;
  rpc.mockClear();
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(redirect).mockClear();
  createSupabaseServerClient.mockReset();
  createSupabaseServerClient.mockImplementation(async () => (state.configured ? makeClient() : null));
});

describe("toggleLike", () => {
  it("toggleLike likes and unlikes with the user's client", async () => {
    const liked = await toggleLike({}, form({ remix_id: REMIX, intent: "like", user_id: OTHER }));
    expect(liked).toMatchObject({ liked: true });
    expect(liked.error).toBeUndefined();
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ table: "likes", method: "insert" });
    const payload = (Array.isArray(writes()[0].payload) ? (writes()[0].payload as unknown[])[0] : writes()[0].payload) as Record<string, unknown>;
    expect(payload.remix_id).toBe(REMIX);
    // never in someone else's name
    if ("user_id" in payload) expect(payload.user_id).toBe(USER.id);
    expect(Object.keys(payload).every((k) => k === "remix_id" || k === "user_id")).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/remixes");

    state.ops = [];
    const unliked = await toggleLike({}, form({ remix_id: REMIX, intent: "unlike", user_id: OTHER }));
    expect(unliked).toMatchObject({ liked: false });
    expect(unliked.error).toBeUndefined();
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ table: "likes", method: "delete" });
    expect(writes()[0].filters).toEqual(expect.arrayContaining([["eq", "remix_id", REMIX], ["eq", "user_id", USER.id]]));
    expect(writes()[0].filters.filter(([, c]) => c === "user_id")).toEqual([["eq", "user_id", USER.id]]);
    // likes never touch usage
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a duplicate like counts as liked", async () => {
    state.error = { code: "23505", message: 'duplicate key value violates unique constraint "likes_pkey"' };
    const res = await toggleLike({}, form({ remix_id: REMIX, intent: "like" }));
    expect(res).toMatchObject({ liked: true });
    expect(res.error).toBeUndefined();
  });

  it("a refused like returns a friendly error", async () => {
    state.error = { code: "42501", message: 'new row violates row-level security policy for table "likes"' };
    const res = await toggleLike({}, form({ remix_id: REMIX, intent: "like" }));
    expect(res.liked).toBe(false);
    expect(res.error).toEqual(expect.any(String));
    expect(res.error).not.toMatch(/row-level|policy|42501/i);

    state.error = { message: "fetch failed" };
    const down = await toggleLike({}, form({ remix_id: REMIX, intent: "unlike" }));
    expect(down.error).toMatch(/try again/i);
    expect(down.liked).toBe(true); // still liked: the unlike did not happen
  });

  it("remix_id must be a uuid", async () => {
    for (const remix_id of ["", "nope", "1; delete from likes", `${REMIX}x`]) {
      const res = await toggleLike({}, form({ remix_id, intent: "like" }));
      expect(res.error).toEqual(expect.any(String));
    }
    const badIntent = await toggleLike({}, form({ remix_id: REMIX, intent: "approve" }));
    expect(badIntent.error).toEqual(expect.any(String));
    expect(state.ops).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("signed-out redirects to sign-in", async () => {
    state.user = null;
    const err = (await toggleLike({}, form({ remix_id: REMIX, intent: "like", return_to: "/recipes/masala-chai" })).catch(
      (e: unknown) => e,
    )) as { digest?: string };
    expect(err.digest).toBe(`NEXT_REDIRECT;/sign-in?next=${encodeURIComponent("/recipes/masala-chai")}`);
    expect(writes()).toEqual([]);

    // an off-site return_to falls back to a same-site page
    const off = (await toggleLike({}, form({ remix_id: REMIX, intent: "like", return_to: "https://evil.example/" })).catch(
      (e: unknown) => e,
    )) as { digest?: string };
    const next = new URLSearchParams(String(off.digest).split("?")[1]).get("next") ?? "";
    expect(next.startsWith("/")).toBe(true);
    expect(next).not.toContain("evil.example");

    const plain = (await toggleLike({}, form({ remix_id: REMIX, intent: "like" })).catch((e: unknown) => e)) as {
      digest?: string;
    };
    expect(plain.digest).toBe(`NEXT_REDIRECT;/sign-in?next=${encodeURIComponent("/remixes")}`);
  });

  it("not configured says not set up yet", async () => {
    state.configured = false;
    const res = await toggleLike({}, form({ remix_id: REMIX, intent: "like" }));
    expect(res.error).toMatch(/not set up yet/i);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("deleteRemix", () => {
  it("deleteRemix deletes the row, then the photo", async () => {
    const res = await deleteRemix({}, form({ remix_id: REMIX, photo_path: `${OTHER}/someone-else.jpg`, user_id: OTHER }));
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ table: "remixes", method: "delete" });
    expect(writes()[0].filters).toEqual(expect.arrayContaining([["eq", "id", REMIX], ["eq", "user_id", USER.id]]));
    expect(writes()[0].filters.filter(([, c]) => c === "user_id")).toEqual([["eq", "user_id", USER.id]]);
    // the photo goes after the row (storage refuses to delete a photo still used by a remix),
    // and it is the deleted row's photo, never a path the browser sent
    expect(state.storage).toEqual([{ bucket: "remix-photos", method: "remove", args: [[PHOTO]] }]);
    expect(state.order.indexOf("remixes.delete")).toBeLessThan(state.order.indexOf("storage.remove"));
    // no remix given back for the day
    expect(rpc).not.toHaveBeenCalled();
    expect(state.ops.map((o) => o.table)).not.toContain("usage");
    expect(revalidatePath).toHaveBeenCalledWith("/remixes");
  });

  it("deleteRemix says not found when RLS deleted nothing", async () => {
    state.deleted = [];
    const res = await deleteRemix({}, form({ remix_id: REMIX }));
    expect(res.ok).toBeUndefined();
    expect(res.error).toMatch(/couldn[’']t find|could not find/i);
    expect(state.storage).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();

    state.deleted = [{ id: REMIX, photo_path: PHOTO }];
    state.error = { code: "42501", message: "permission denied for table remixes" };
    const failed = await deleteRemix({}, form({ remix_id: REMIX }));
    expect(failed.error).toEqual(expect.any(String));
    expect(failed.error).not.toMatch(/permission denied/);
    expect(state.storage).toEqual([]);
  });

  it("deleteRemix validates the id, redirects signed-out users and says not set up yet", async () => {
    for (const remix_id of ["", "nope", "' or true --"]) {
      const res = await deleteRemix({}, form({ remix_id }));
      expect(res.error).toEqual(expect.any(String));
    }
    expect(state.ops).toEqual([]);
    expect(state.storage).toEqual([]);

    state.user = null;
    const err = (await deleteRemix({}, form({ remix_id: REMIX })).catch((e: unknown) => e)) as { digest?: string };
    expect(String(err.digest)).toMatch(/^NEXT_REDIRECT;\/sign-in\?next=/);
    expect(writes()).toEqual([]);

    state.configured = false;
    const res = await deleteRemix({}, form({ remix_id: REMIX }));
    expect(res.error).toMatch(/not set up yet/i);
  });
});

/* ---------- slice B review finding NIT2 ---------- */
describe("toggleLike revalidation", () => {
  const revalidated = () => vi.mocked(revalidatePath).mock.calls.map((c) => c[0]).sort();

  it("NIT2: revalidates /remixes, plus /recipes/<slug> only when return_to is a recipe page", async () => {
    await toggleLike({}, form({ remix_id: REMIX, intent: "like", return_to: "/recipes/masala-chai" }));
    expect(revalidated()).toEqual(["/recipes/masala-chai", "/remixes"]);

    vi.mocked(revalidatePath).mockClear();
    await toggleLike({}, form({ remix_id: REMIX, intent: "unlike", return_to: "/recipes/masala-chai?page=2#remixes" }));
    expect(revalidated()).toEqual(["/recipes/masala-chai", "/remixes"]);

    for (const return_to of ["/", "/cookbook", "/admin", "/recipes", "/recipes/masala-chai/remix", "/remixes?recipe=masala-chai", "/challenges/x"]) {
      vi.mocked(revalidatePath).mockClear();
      await toggleLike({}, form({ remix_id: REMIX, intent: "like", return_to }));
      expect({ return_to, paths: revalidated() }).toEqual({ return_to, paths: ["/remixes"] });
    }
  });

  it("NIT2: return_to is still used for the sign-in redirect", async () => {
    state.user = null;
    const err = (await toggleLike({}, form({ remix_id: REMIX, intent: "like", return_to: "/" })).catch((e: unknown) => e)) as {
      digest?: string;
    };
    expect(err.digest).toBe(`NEXT_REDIRECT;/sign-in?next=${encodeURIComponent("/")}`);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
