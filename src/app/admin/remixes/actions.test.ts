import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
 * Contract (src/app/admin/remixes/actions.ts, "use server", useActionState actions):
 *   ModerationActionState = { ok?: boolean; message?: string; error?: string }
 *   approveRemix(prev, formData{ remix_id, recipe_slug? })
 *     -> rpc("admin_moderate_remix", { p_remix_id, p_action: "approve" })
 *   hideRemix(prev, formData{ remix_id, recipe_slug? })
 *     -> rpc("admin_moderate_remix", { p_remix_id, p_action: "hide" })
 *   banUser(prev, formData{ user_id, reason?, confirm: "yes" })
 *     -> rpc("admin_ban_user", { p_user_id, p_reason }) (reason trimmed, up to 500, blank -> null)
 *   unbanUser(prev, formData{ user_id }) -> rpc("admin_unban_user", { p_user_id })
 * Every action:
 *   - checks admin on the server first with the admin's own session client (requireAdminClient);
 *     a signed-in non-admin gets { error } and no rpc; signed out (Supabase set up) redirects to
 *     /sign-in?next=%2Fadmin%2Fremixes. Never a service-role client, never a direct table update.
 *   - ids must be uuids (no rpc otherwise); recipe_slug is used only if it is a valid slug.
 *   - database errors: 42501 -> "only Shef's admins"; SMM01 -> "can't ban an admin";
 *     SMM02 (approving a banned cook's remix) -> "This cook is banned. Unban them first.";
 *     P0002 (no such remix) -> the same message as a bad id;
 *     anything else -> "try again" (never the raw message).
 *   - success revalidates /admin/remixes, /admin (the waiting count) and /remixes; approve and hide
 *     also /recipes/<recipe_slug>; ban and unban also every recipe page ("/recipes/[slug]", "page").
 */

type Rpc = { fn: string; args: Record<string, unknown> | undefined };
const { state } = vi.hoisted(() => ({
  state: {
    user: null as { id: string; email: string } | null,
    profile: null as { id: string; is_admin: boolean } | null,
    rpcError: null as { message: string; code?: string } | null,
    rpcs: [] as Rpc[],
    writes: [] as string[],
  },
}));

function makeClient() {
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["insert", "update", "delete", "upsert"]) {
      b[m] = () => {
        state.writes.push(`${table}.${m}`);
        return b;
      };
    }
    for (const f of ["select", "eq", "neq", "is", "in", "order", "limit"]) b[f] = () => b;
    const result = () => (table === "profiles" ? { data: state.profile, error: null } : { data: [], error: null });
    b.single = async () => result();
    b.maybeSingle = async () => result();
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    return b;
  };
  return {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: vi.fn(from),
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      state.rpcs.push({ fn, args });
      return state.rpcError ? { data: null, error: state.rpcError } : { data: null, error: null };
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => makeClient()) }));
const { serviceApply } = vi.hoisted(() => ({ serviceApply: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ applyAiVerdict: serviceApply }));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath, revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  }),
}));

import { approveRemix, banUser, hideRemix, unbanUser } from "./actions";

const ADMIN = { id: "a0000000-0000-4000-8000-000000000001", email: "shef@example.com" };
const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const REMIX = "33333333-3333-4333-8333-333333333333";
const TARGET = "c0000000-0000-4000-8000-000000000003";

function signIn(as: "admin" | "user" | null) {
  state.user = as === "admin" ? ADMIN : as === "user" ? USER : null;
  state.profile = as === "admin" ? { id: ADMIN.id, is_admin: true } : as === "user" ? { id: USER.id, is_admin: false } : null;
}
function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const ALL = [
  { name: "approve", run: () => approveRemix({}, form({ remix_id: REMIX, recipe_slug: "masala-chai" })) },
  { name: "hide", run: () => hideRemix({}, form({ remix_id: REMIX, recipe_slug: "masala-chai" })) },
  { name: "ban", run: () => banUser({}, form({ user_id: TARGET, reason: "spam", confirm: "yes" })) },
  { name: "unban", run: () => unbanUser({}, form({ user_id: TARGET })) },
];

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  signIn("admin");
  state.rpcError = null;
  state.rpcs = [];
  state.writes = [];
  revalidatePath.mockClear();
  serviceApply.mockClear();
});

describe("admin remix actions", () => {
  it("approve, hide, ban and unban call the admin functions with the admin's client", async () => {
    for (const a of ALL) {
      const res = await a.run();
      expect({ action: a.name, ok: res.ok, error: res.error }).toEqual({ action: a.name, ok: true, error: undefined });
    }
    expect(state.rpcs).toEqual([
      { fn: "admin_moderate_remix", args: { p_remix_id: REMIX, p_action: "approve" } },
      { fn: "admin_moderate_remix", args: { p_remix_id: REMIX, p_action: "hide" } },
      { fn: "admin_ban_user", args: { p_user_id: TARGET, p_reason: "spam" } },
      { fn: "admin_unban_user", args: { p_user_id: TARGET } },
    ]);
    // never a direct table write and never the service-role path
    expect(state.writes).toEqual([]);
    expect(serviceApply).not.toHaveBeenCalled();
  });

  it("ban trims the reason, caps it at 500 and sends null when blank", async () => {
    await banUser({}, form({ user_id: TARGET, reason: `  ${"x".repeat(600)}  `, confirm: "yes" }));
    await banUser({}, form({ user_id: TARGET, reason: "   ", confirm: "yes" }));
    await banUser({}, form({ user_id: TARGET, confirm: "yes" }));
    expect(state.rpcs.map((r) => r.args!.p_reason)).toEqual(["x".repeat(500), null, null]);
  });

  it("non-admins are refused on the server", async () => {
    signIn("user");
    for (const a of ALL) {
      const res = await a.run();
      expect(res.ok).toBeFalsy();
      expect(res.error).toMatch(/admin/i);
    }
    expect(state.rpcs).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();

    signIn(null);
    for (const a of ALL) {
      await expect(a.run()).rejects.toThrow("NEXT_REDIRECT /sign-in?next=%2Fadmin%2Fremixes");
    }
    expect(state.rpcs).toEqual([]);
  });

  it("ids are validated", async () => {
    for (const bad of ["", "abc", `${REMIX}' or '1'='1`, "33333333-3333-4333-8333-33333333333"]) {
      expect((await approveRemix({}, form({ remix_id: bad }))).error).toEqual(expect.any(String));
      expect((await hideRemix({}, form({ remix_id: bad }))).error).toEqual(expect.any(String));
      expect((await banUser({}, form({ user_id: bad, confirm: "yes" }))).error).toEqual(expect.any(String));
      expect((await unbanUser({}, form({ user_id: bad }))).error).toEqual(expect.any(String));
    }
    expect(state.rpcs).toEqual([]);
  });

  it("ban needs the confirm field", async () => {
    for (const confirm of [undefined, "", "no", "YES please"]) {
      const fd = form({ user_id: TARGET, reason: "spam" });
      if (confirm !== undefined) fd.set("confirm", confirm);
      const res = await banUser({}, fd);
      expect(res.ok).toBeFalsy();
      expect(res.error).toMatch(/confirm/i);
    }
    expect(state.rpcs).toEqual([]);
  });

  it("database errors become friendly messages", async () => {
    state.rpcError = { code: "SMM01", message: "cannot ban an admin" };
    expect((await banUser({}, form({ user_id: TARGET, confirm: "yes" }))).error).toMatch(/can't ban an admin/i);
    state.rpcError = { code: "42501", message: "permission denied for function admin_moderate_remix" };
    const denied = await approveRemix({}, form({ remix_id: REMIX }));
    expect(denied.error).toMatch(/only shef's admins/i);
    state.rpcError = { code: "P0001", message: "remix author is banned: internal detail" };
    const other = await approveRemix({}, form({ remix_id: REMIX }));
    expect(other.error).toMatch(/try again/i);
    expect(other.error).not.toMatch(/internal detail|permission denied/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("NIT2: approving a banned cook's remix says unban them first", async () => {
    state.rpcError = { code: "SMM02", message: "the author of this remix is banned" };
    const res = await approveRemix({}, form({ remix_id: REMIX, recipe_slug: "masala-chai" }));
    expect(res.ok).toBeFalsy();
    expect(res.error).toBe("This cook is banned. Unban them first.");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("NIT9: a remix that no longer exists (P0002) gets the bad-id message", async () => {
    const badId = (await approveRemix({}, form({ remix_id: "not-a-uuid" }))).error;
    expect(badId).toEqual(expect.any(String));
    state.rpcError = { code: "P0002", message: "admin_moderate_remix: remix not found" };
    for (const run of [
      () => approveRemix({}, form({ remix_id: REMIX })),
      () => hideRemix({}, form({ remix_id: REMIX })),
    ]) {
      const res = await run();
      expect(res.ok).toBeFalsy();
      expect(res.error).toBe(badId);
      expect(res.error).not.toMatch(/admin_moderate_remix|not found:/);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("revalidates /admin/remixes, /remixes and the recipe page", async () => {
    await approveRemix({}, form({ remix_id: REMIX, recipe_slug: "masala-chai" }));
    let paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(expect.arrayContaining(["/admin/remixes", "/admin", "/remixes", "/recipes/masala-chai"]));

    revalidatePath.mockClear();
    await hideRemix({}, form({ remix_id: REMIX, recipe_slug: "../../etc" }));
    paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(expect.arrayContaining(["/admin/remixes", "/remixes"]));
    expect(paths.some((p) => String(p).includes(".."))).toBe(false);

    revalidatePath.mockClear();
    await banUser({}, form({ user_id: TARGET, confirm: "yes" }));
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["/admin/remixes", "/remixes"]));
    expect(revalidatePath).toHaveBeenCalledWith("/recipes/[slug]", "page");

    revalidatePath.mockClear();
    await unbanUser({}, form({ user_id: TARGET }));
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["/admin/remixes", "/remixes"]));
  });
});
