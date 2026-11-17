import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { geminiJson, makeFakeClient, newFakeDb, type FakeDb } from "@/test/fake-supabase-rls";

const { db } = vi.hoisted(() => ({ db: { current: null as unknown as FakeDb } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
    db.current.sessionClients++;
    return makeFakeClient(db.current, "session");
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => makeFakeClient(db.current, "anon")),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
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

import { addReelAction } from "./actions";

/*
 * Contract: addReelAction(prev, formData{url, caption}) -> AddReelFormState, or redirect().
 * Uses the user's session client: rpc usage_remaining / consume_usage { kind: "outside_reel", lim: 5 },
 * recipes insert (unique violation 23505 means retry with a new slug), saves insert (unfiled).
 */
const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const REEL = "https://www.instagram.com/nani.cooks/reel/C5mAsalaCh1/?igsh=abc";
const CAPTION = "Masala chai. 1 cup water, 1 cup milk, 2 tsp tea. Boil and strain.";
const MODEL_OUTPUT = {
  has_recipe: true,
  title: "Masala Chai",
  description: "Spiced tea.",
  ingredients: [{ qty: 1, unit: "cup", item: "water", note: null }],
  steps: [{ text: "Boil." }],
  base_servings: 2,
  prep_minutes: 2,
  cook_minutes: 8,
  cuisine: "indian",
  diet_tags: ["vegetarian"],
  allergens: ["milk"],
  categories: ["drinks"],
};

const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => geminiJson(MODEL_OUTPUT));

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

async function settle<T>(p: Promise<T>): Promise<{ value?: T; redirected?: string; error?: unknown }> {
  try {
    return { value: await p };
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (digest?.startsWith("NEXT_REDIRECT;")) return { redirected: digest.slice("NEXT_REDIRECT;".length) };
    return { error: e };
  }
}

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("GEMINI_API_KEY", "server-gemini-key");
}

const writes = (table: string) => db.current.writes.filter((w) => w.table === table);
const payload = (w: { payload: unknown }) =>
  (Array.isArray(w.payload) ? w.payload[0] : w.payload) as Record<string, unknown>;

beforeEach(() => {
  db.current = newFakeDb();
  db.current.rpcResult.usage_remaining = { data: 3, error: null };
  db.current.rpcResult.consume_usage = { data: 2, error: null };
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("addReelAction", () => {
  it("addReelAction redirects to /recipes/<slug> on success", async () => {
    configure();
    db.current.user = USER;
    const r = await settle(addReelAction(null, form({ url: REEL, caption: CAPTION })));
    expect(r.error).toBeUndefined();
    expect(r.redirected).toMatch(/^\/recipes\/reel-masala-chai-[a-z0-9]{6}$/);

    expect(db.current.rpcs.map((c) => [c.client, c.fn, c.args])).toEqual([
      ["session", "usage_remaining", { kind: "outside_reel", lim: 5 }],
      ["session", "consume_usage", { kind: "outside_reel", lim: 5 }],
    ]);
    const [ins] = writes("recipes");
    expect(ins.client).toBe("session");
    expect(ins.method).toBe("insert");
    expect(payload(ins)).toMatchObject({
      source: "outside",
      status: "live",
      owner_id: USER.id,
      reel_url: "https://www.instagram.com/nani.cooks/reel/C5mAsalaCh1/",
      cover_image_url: null,
      youtube_url: null,
    });
    expect(r.redirected).toBe(`/recipes/${payload(ins).slug}`);

    const [save] = writes("saves");
    expect(save.client).toBe("session");
    expect(payload(save)).toMatchObject({ user_id: USER.id });
    expect(String(payload(save).recipe_id)).toMatch(/^recipes-new-/); // the id the insert returned
    expect(payload(save).folder_id ?? null).toBeNull();
    // Gemini key comes from the server env, in a header
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get("x-goog-api-key")).toBe("server-gemini-key");
  });

  it("maps a duplicate slug (23505) to a retry with a new slug", async () => {
    configure();
    db.current.user = USER;
    db.current.insertErrors.recipes = [
      { code: "23505", message: 'duplicate key value violates unique constraint "recipes_slug_key"' },
    ];
    const r = await settle(addReelAction(null, form({ url: REEL, caption: CAPTION })));
    const tries = writes("recipes");
    expect(tries).toHaveLength(2);
    expect(payload(tries[0]).slug).not.toBe(payload(tries[1]).slug);
    expect(r.redirected).toBe(`/recipes/${payload(tries[1]).slug}`);
  });

  it("bad input returns field errors and touches nothing", async () => {
    configure();
    db.current.user = USER;
    const r = await settle(
      addReelAction(null, form({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", caption: "" })),
    );
    expect(r.redirected).toBeUndefined();
    expect(r.value).toMatchObject({ status: "invalid" });
    const errors = (r.value as { errors: Record<string, string> }).errors;
    expect(errors.url).toBeTruthy();
    expect(errors.caption).toBeTruthy();
    expect(db.current.rpcs).toEqual([]);
    expect(db.current.writes).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no recipe in the caption returns the message and spends no reel", async () => {
    configure();
    db.current.user = USER;
    fetchSpy.mockResolvedValueOnce(geminiJson({ has_recipe: false }));
    const r = await settle(addReelAction(null, form({ url: REEL, caption: "Sunset vibes #nz" })));
    expect(r.value).toMatchObject({ status: "no-recipe", remaining: 3 });
    expect(db.current.rpcs.map((c) => c.fn)).not.toContain("consume_usage");
    expect(db.current.writes).toEqual([]);
  });

  it("signed-out redirects to sign-in with returnTo /add-reel", async () => {
    configure();
    db.current.user = null;
    const r = await settle(addReelAction(null, form({ url: REEL, caption: CAPTION })));
    expect(r.redirected).toBe(`/sign-in?next=${encodeURIComponent("/add-reel")}`);
    expect(db.current.rpcs).toEqual([]);
    expect(db.current.writes).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("not configured returns not set up yet", async () => {
    const r = await settle(addReelAction(null, form({ url: REEL, caption: CAPTION })));
    expect(r.redirected).toBeUndefined();
    expect(r.value).toMatchObject({ status: "not-configured" });
    expect((r.value as { message: string }).message).toMatch(/not set up yet/i);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Supabase set up but no Gemini key: no reel is spent
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    db.current.user = USER;
    const r2 = await settle(addReelAction(null, form({ url: REEL, caption: CAPTION })));
    expect(r2.value).toMatchObject({ status: "not-configured" });
    expect(db.current.rpcs.map((c) => c.fn)).not.toContain("consume_usage");
    expect(db.current.writes).toEqual([]);
  });
});
