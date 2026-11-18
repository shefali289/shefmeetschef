import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChallengeFormState, PickWinnerState } from "@/lib/challenges/types";

vi.mock("server-only", () => ({}));

/*
 * Contract (src/app/admin/challenges/actions.ts, "use server", useActionState actions):
 *   createChallenge(prev, formData) -> { ok: true, id } | { errors: { field | form: message } }
 *     - admin checked on the server with the admin's own session client (requireAdminClient);
 *       signed-out (with Supabase set up) redirects to /sign-in?next=%2Fadmin%2Fchallenges;
 *       a signed-in non-admin never writes (returns errors.form or throws).
 *     - zod: title trimmed 1..200; description trimmed, up to 2000 (blank -> null);
 *       base_recipe_id a uuid; starts_on / ends_on real YYYY-MM-DD dates, ends_on >= starts_on;
 *       blank dates default to defaultChallengeWeek() (Monday to Sunday NZ).
 *     - inserts only { base_recipe_id, title, description, starts_on, ends_on } into challenges.
 *     - database errors: SMC01 (base recipe not a live Shef recipe) -> errors.base_recipe_id,
 *       23P01 (overlap) -> a friendly "overlaps another challenge" message; others "try again".
 *     - success revalidates "/", "/challenges", "/challenges/<id>", "/admin/challenges" and the
 *       base recipe page ("/recipes/<slug>" or "/recipes/[slug]" "page").
 *   pickWinner(prev, formData: challenge_id, remix_id) -> { ok: true } | { error }
 *     - admin checked the same way; both ids must be uuids (no write otherwise).
 *     - updates only { winner_remix_id } on challenges where id = challenge_id.
 *     - SMC02 -> "once the challenge has ended"; SMC03 -> "approved entry of this challenge".
 *     - success revalidates "/", "/challenges" and "/challenges/<id>".
 */

type DbError = { message: string; code?: string };
type Op = { table: string; method: string; payload?: unknown; filters: [string, string, unknown][] };

const { state } = vi.hoisted(() => ({
  state: {
    user: null as { id: string; email: string } | null,
    profile: null as { id: string; is_admin: boolean } | null,
    recipe: null as Record<string, unknown> | null,
    writeError: null as DbError | null,
    ops: [] as Op[],
  },
}));

function makeClient() {
  const from = (table: string) => {
    const op: Op = { table, method: "select", filters: [] };
    state.ops.push(op);
    const result = (single: boolean) => {
      if (table === "profiles") return { data: state.profile, error: null };
      if (op.method === "select") {
        const rows = table === "recipes" && state.recipe ? [state.recipe] : [];
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      }
      if (state.writeError) return { data: null, error: state.writeError };
      const row = { id: "c0000000-0000-4000-8000-0000000000aa", base_recipe_id: RECIPE_ID, ...(op.payload as object) };
      return { data: single ? row : [row], error: null, count: 1 };
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
    for (const f of ["eq", "neq", "is", "in", "match", "filter", "order", "limit", "not", "lt", "lte", "gt", "gte"]) {
      b[f] = (col: string, val?: unknown) => {
        op.filters.push([f, col, val]);
        return b;
      };
    }
    b.returns = () => b;
    b.single = async () => result(true);
    b.maybeSingle = async () => result(true);
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result(false)).then(res, rej);
    return b;
  };
  return {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: vi.fn(from),
    rpc: vi.fn(async () => ({ data: null, error: { message: "no rpc" } })),
  };
}

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => makeClient()) }));
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
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  }),
}));

import { createChallenge, pickWinner } from "./actions";

const ADMIN = { id: "a0000000-0000-4000-8000-000000000001", email: "shef@example.com" };
const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const CHALLENGE_ID = "c0000000-0000-4000-8000-0000000000aa";
const REMIX_ID = "22222222-2222-4222-8222-222222222222";

function signIn(as: "admin" | "user" | null) {
  state.user = as === "admin" ? ADMIN : as === "user" ? USER : null;
  state.profile = as === "admin" ? { id: ADMIN.id, is_admin: true } : as === "user" ? { id: USER.id, is_admin: false } : null;
}

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const valid = (over: Record<string, string> = {}) =>
  form({
    title: "Chai, your way",
    description: "Swap the milk, the spice, anything.",
    base_recipe_id: RECIPE_ID,
    starts_on: "2026-11-23",
    ends_on: "2026-11-29",
    ...over,
  });

const writes = (table = "challenges") => state.ops.filter((o) => o.table === table && o.method !== "select");

/** Runs an action and returns its result, or "threw" / the redirect URL. */
async function outcome<T>(run: () => Promise<T>): Promise<T | { threw: string }> {
  try {
    return await run();
  } catch (e) {
    return { threw: String((e as Error).message) };
  }
}

const errorText = (r: unknown) => JSON.stringify(r);
const revalidated = () => revalidatePath.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  state.ops = [];
  state.writeError = null;
  state.recipe = { id: RECIPE_ID, slug: "masala-chai", title: "Masala Chai", source: "shef", status: "live" };
  revalidatePath.mockClear();
  signIn("admin");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("admin challenge actions", () => {
  it("createChallenge checks admin on the server", async () => {
    signIn(null);
    const out = await outcome(() => createChallenge(null, valid()));
    expect(out).toEqual({ threw: expect.stringContaining("NEXT_REDIRECT /sign-in?next=%2Fadmin%2Fchallenges") });
    expect(writes()).toEqual([]);

    signIn("user");
    const asUser = await outcome(() => createChallenge(null, valid()));
    expect(writes()).toEqual([]);
    expect(errorText(asUser)).toMatch(/admin/i);
    expect((asUser as ChallengeFormState)?.ok).not.toBe(true);

    signIn("admin");
    const ok = await createChallenge(null, valid());
    expect(ok).toEqual({ ok: true, id: CHALLENGE_ID });
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ method: "insert" });
  });

  it("inserts only the challenge fields, trimmed, with the admin's client", async () => {
    const fd = valid({ title: "  Chai, your way  ", description: "   " });
    fd.set("winner_remix_id", REMIX_ID);
    fd.set("id", "dddddddd-0000-4000-8000-000000000000");
    fd.set("created_at", "2020-01-01");
    await createChallenge(null, fd);
    const [insert] = writes();
    const payload = (Array.isArray(insert.payload) ? insert.payload[0] : insert.payload) as Record<string, unknown>;
    expect(payload).toEqual({
      base_recipe_id: RECIPE_ID,
      title: "Chai, your way",
      description: null,
      starts_on: "2026-11-23",
      ends_on: "2026-11-29",
    });
  });

  it("validates title 1 to 200, description up to 2000, end on or after start, base recipe uuid", async () => {
    const cases: [Record<string, string>, string][] = [
      [{ title: "" }, "title"],
      [{ title: "   " }, "title"],
      [{ title: "t".repeat(201) }, "title"],
      [{ description: "d".repeat(2001) }, "description"],
      [{ base_recipe_id: "masala-chai" }, "base_recipe_id"],
      [{ base_recipe_id: "" }, "base_recipe_id"],
      [{ starts_on: "2026-02-30" }, "starts_on"],
      [{ starts_on: "23/11/2026" }, "starts_on"],
      [{ ends_on: "not a date" }, "ends_on"],
      [{ starts_on: "2026-11-29", ends_on: "2026-11-23" }, "ends_on"],
    ];
    for (const [over, field] of cases) {
      state.ops = [];
      const res = await createChallenge(null, valid(over));
      expect({ over, field: Object.keys(res?.errors ?? {}) }).toEqual({ over, field: expect.arrayContaining([field]) });
      expect(res?.ok).not.toBe(true);
      expect(writes()).toEqual([]);
    }

    // the limits themselves are fine
    const limits: Record<string, string>[] = [{ title: "t".repeat(200) }, { description: "d".repeat(2000) }, { starts_on: "2026-11-29", ends_on: "2026-11-29" }];
    for (const over of limits) {
      state.ops = [];
      expect(await createChallenge(null, valid(over))).toMatchObject({ ok: true });
    }
  });

  it("blank dates default to Monday to Sunday NZ", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T01:00:00Z")); // Wednesday in NZ
    await createChallenge(null, valid({ starts_on: "", ends_on: "" }));
    const payload = writes()[0]?.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ starts_on: "2026-11-23", ends_on: "2026-11-29" });
  });

  it("overlap and non-live recipe errors become friendly messages", async () => {
    state.writeError = { code: "23P01", message: "challenge dates overlap another challenge" };
    const overlap = await createChallenge(null, valid());
    expect(overlap?.ok).not.toBe(true);
    expect(errorText(overlap?.errors)).toMatch(/overlaps? another challenge/i);
    expect(errorText(overlap)).not.toContain("23P01");

    state.writeError = { code: "SMC01", message: "challenge base recipe must be a live Shef recipe" };
    const notLive = await createChallenge(null, valid());
    expect(notLive?.errors?.base_recipe_id).toMatch(/live Shef recipe/i);
    expect(errorText(notLive)).not.toContain("SMC01");

    state.writeError = { code: "XX000", message: "connection reset by peer" };
    const other = await createChallenge(null, valid());
    expect(other?.errors?.form).toMatch(/try again/i);
    expect(errorText(other)).not.toContain("connection reset");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("pickWinner checks admin and maps not ended and not an entry errors", async () => {
    const fd = () => form({ challenge_id: CHALLENGE_ID, remix_id: REMIX_ID });

    signIn(null);
    expect(await outcome(() => pickWinner(null, fd()))).toEqual({
      threw: expect.stringContaining("NEXT_REDIRECT /sign-in?next="),
    });
    signIn("user");
    const asUser = await outcome(() => pickWinner(null, fd()));
    expect((asUser as PickWinnerState)?.ok).not.toBe(true);
    expect(writes()).toEqual([]);

    signIn("admin");
    for (const bad of [{ challenge_id: "x", remix_id: REMIX_ID }, { challenge_id: CHALLENGE_ID, remix_id: "" }]) {
      const res = await pickWinner(null, form(bad));
      expect(res?.ok).not.toBe(true);
      expect(res?.error).toBeTruthy();
    }
    expect(writes()).toEqual([]);

    state.writeError = { code: "SMC02", message: "challenge has not ended yet" };
    const early = await pickWinner(null, fd());
    expect(early?.error).toMatch(/once the challenge has ended/i);

    state.writeError = { code: "SMC03", message: "winner must be an approved entry of this challenge" };
    const notEntry = await pickWinner(null, fd());
    expect(notEntry?.error).toMatch(/approved entry of this challenge/i);
    expect(errorText(notEntry)).not.toContain("SMC03");

    state.writeError = null;
    state.ops = [];
    expect(await pickWinner(null, fd())).toEqual({ ok: true });
    const [update] = writes();
    expect(update).toMatchObject({ table: "challenges", method: "update", payload: { winner_remix_id: REMIX_ID } });
    expect(Object.keys(update.payload as object)).toEqual(["winner_remix_id"]);
    expect(update.filters).toContainEqual(["eq", "id", CHALLENGE_ID]);
  });

  it("revalidates /, /challenges, the challenge page and the base recipe", async () => {
    await createChallenge(null, valid());
    const paths = revalidated();
    expect(paths).toEqual(expect.arrayContaining(["/", "/challenges", `/challenges/${CHALLENGE_ID}`, "/admin/challenges"]));
    expect(paths.some((p) => p === "/recipes/masala-chai" || p === "/recipes/[slug]")).toBe(true);

    revalidatePath.mockClear();
    await pickWinner(null, form({ challenge_id: CHALLENGE_ID, remix_id: REMIX_ID }));
    expect(revalidated()).toEqual(expect.arrayContaining(["/", "/challenges", `/challenges/${CHALLENGE_ID}`]));
  });
});
