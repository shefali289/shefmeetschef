import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/* ---------- fake Supabase client (records every query) ---------- */
type Op = {
  table: string;
  method: "select" | "insert" | "update" | "delete" | "upsert";
  payload?: Record<string, unknown>;
  filters: [string, string, unknown][];
};
type FakeState = {
  user: { id: string; email: string } | null;
  profile: { id: string; is_admin: boolean } | null;
  recipe: Record<string, unknown> | null;
};
const state: { ops: Op[]; fake: FakeState; uploads: unknown[] } = {
  ops: [],
  fake: { user: null, profile: null, recipe: null },
  uploads: [],
};

function makeClient() {
  const from = (table: string) => {
    const op: Op = { table, method: "select", filters: [] };
    state.ops.push(op);
    const result = (single: boolean) => {
      if (table === "profiles") return { data: state.fake.profile, error: null };
      if (table === "recipes" && op.method === "select") {
        const r = state.fake.recipe;
        return { data: single ? r : r ? [r] : [], error: null };
      }
      return { data: single ? null : [], error: null };
    };
    const b: Record<string, unknown> = {};
    for (const m of ["insert", "update", "delete", "upsert"] as const) {
      b[m] = (payload?: Record<string, unknown>) => {
        op.method = m;
        op.payload = payload;
        return b;
      };
    }
    b.select = () => b;
    for (const f of ["eq", "neq", "is", "in", "match", "filter", "order", "limit", "not"]) {
      b[f] = (col: string, val?: unknown) => {
        op.filters.push([f, col, val]);
        return b;
      };
    }
    b.single = async () => result(true);
    b.maybeSingle = async () => result(true);
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result(false)).then(res, rej);
    return b;
  };
  return {
    auth: { getUser: async () => ({ data: { user: state.fake.user }, error: null }) },
    from: vi.fn(from),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: unknown) => {
          state.uploads.push({ bucket, path, body });
          return { data: { path }, error: null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://abc.supabase.co/storage/v1/object/public/${bucket}/${path}` },
        }),
      }),
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => makeClient()),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
const { cookieSet } = vi.hoisted(() => ({ cookieSet: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: cookieSet, delete: vi.fn() })),
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
const { copyCoverToStorage } = vi.hoisted(() => ({
  copyCoverToStorage: vi.fn(async (_o: { url: string; slug: string }) => null as string | null),
}));
vi.mock("@/lib/import/copy-cover", () => ({ copyCoverToStorage }));

import * as actions from "./actions";

/*
 * Contract: updateDraft is a useActionState action:
 *   updateDraft(prevState: {errors?}, formData) -> Promise<{errors?: Record<string, string>}>
 * Bad input returns {errors} (never throws). Valid input saves and redirects.
 */
type DraftFormState = { errors?: Record<string, string> };
const updateDraft = actions.updateDraft as unknown as (
  prev: DraftFormState,
  fd: FormData,
) => Promise<DraftFormState>;
const importNow = actions.importNow as unknown as () => Promise<unknown>;

const ID = "11111111-1111-4111-8111-111111111111";
const ADMIN = { id: "a0000000-0000-4000-8000-000000000001", email: "shef@example.com" };
const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };

const draftRow = {
  id: ID,
  slug: "paneer-tikka",
  title: "Paneer Tikka",
  status: "draft",
  published_at: null,
  cover_image_url: "https://cdninstagram.example/t/abc.jpg",
};

function validForm(over: Record<string, string | string[]> = {}): FormData {
  const base: Record<string, string | string[]> = {
    id: ID,
    intent: "save",
    title: "Paneer Tikka",
    description: "Smoky.",
    base_servings: "2",
    prep_minutes: "10",
    cook_minutes: "12",
    cuisine: "indian",
    diet_tags: ["vegetarian"],
    allergens: ["milk"],
    categories: ["air-fryer"],
    ingredient_qty: ["200"],
    ingredient_unit: ["g"],
    ingredient_item: ["paneer"],
    ingredient_note: [""],
    step: ["Marinate.", "Air fry."],
    ...over,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(base)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

/** Awaits a server action, treating Next's redirect throw as success. */
async function settle<T>(p: Promise<T>): Promise<{ value?: T; redirected?: string; error?: unknown }> {
  try {
    return { value: await p };
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (digest?.startsWith("NEXT_REDIRECT")) return { redirected: digest };
    return { error: e };
  }
}

const recipeOps = () => state.ops.filter((o) => o.table !== "profiles");
const recipeUpdates = () => state.ops.filter((o) => o.table === "recipes" && o.method === "update");

function signInAs(who: "anon" | "user" | "admin") {
  state.fake.user = who === "anon" ? null : who === "admin" ? ADMIN : USER;
  state.fake.profile =
    who === "anon" ? null : { id: state.fake.user!.id, is_admin: who === "admin" };
}

const fetchSpy = vi.fn(async () => new Response("{}"));

beforeEach(() => {
  state.ops = [];
  state.uploads = [];
  state.fake = { user: null, profile: null, recipe: { ...draftRow } };
  copyCoverToStorage.mockReset();
  copyCoverToStorage.mockResolvedValue(null);
  cookieSet.mockClear();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("GEMINI_API_KEY", "g-key");
  vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Rejected = threw (not a redirect to a success page) or returned errors; and nothing touched the DB. */
async function expectRejectedBeforeDb(p: Promise<unknown>) {
  const r = await settle(p);
  const rejected =
    r.error !== undefined ||
    (r.value !== undefined && typeof r.value === "object" && r.value !== null && "errors" in r.value) ||
    (r.redirected !== undefined && /sign-in/.test(r.redirected));
  expect(rejected).toBe(true);
  expect(recipeOps()).toEqual([]);
  expect(state.uploads).toEqual([]);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(cookieSet).not.toHaveBeenCalled();
}

describe("admin server actions: auth", () => {
  it("importNow rejects anon before any DB call", async () => {
    signInAs("anon");
    await expectRejectedBeforeDb(importNow());
  });

  it("importNow rejects non-admin before any DB call", async () => {
    signInAs("user");
    await expectRejectedBeforeDb(importNow());
  });

  it("updateDraft rejects anon before any DB call", async () => {
    signInAs("anon");
    await expectRejectedBeforeDb(updateDraft({}, validForm()));
  });

  it("updateDraft rejects non-admin before any DB call", async () => {
    signInAs("user");
    await expectRejectedBeforeDb(updateDraft({}, validForm({ intent: "publish" })));
  });
});

describe("updateDraft input handling", () => {
  beforeEach(() => signInAs("admin"));

  it("ignores extra slug/status/source/owner_id/instagram_id fields", async () => {
    const fd = validForm();
    fd.append("slug", "hacked");
    fd.append("status", "live");
    fd.append("source", "outside");
    fd.append("owner_id", USER.id);
    fd.append("instagram_id", "999");
    fd.append("youtube_id", "yyy");
    fd.append("published_at", "1999-01-01T00:00:00Z");
    const r = await settle(updateDraft({}, fd));
    expect(r.error).toBeUndefined();
    const updates = recipeUpdates();
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
      for (const k of ["slug", "status", "source", "owner_id", "instagram_id", "youtube_id", "published_at", "id"]) {
        expect(u.payload ?? {}, k).not.toHaveProperty(k);
      }
      expect(u.filters).toContainEqual(["eq", "id", ID]);
    }
    expect(updates[0].payload).toMatchObject({
      title: "Paneer Tikka",
      ingredients: [{ qty: 200, unit: "g", item: "paneer", note: null }],
      steps: [{ text: "Marinate." }, { text: "Air fry." }],
    });
  });

  it.each([
    ["non-uuid id", validForm({ id: "1; drop table recipes" })],
    ["empty ingredients", validForm({ ingredient_qty: [], ingredient_unit: [], ingredient_item: [], ingredient_note: [] })],
    ["qty=abc", validForm({ ingredient_qty: ["abc"] })],
    ["empty title", validForm({ title: "   " })],
    ["unknown cuisine", validForm({ cuisine: "martian" })],
  ])("returns {errors} instead of throwing on bad input: %s", async (_name, fd) => {
    const r = await settle(updateDraft({}, fd));
    expect(r.error).toBeUndefined();
    expect(r.redirected).toBeUndefined();
    expect(r.value).toBeDefined();
    expect(Object.keys(r.value!.errors ?? {}).length).toBeGreaterThan(0);
    expect(recipeUpdates()).toEqual([]);
  });
});

describe("updateDraft publish", () => {
  beforeEach(() => signInAs("admin"));

  it("publishing a draft sets status live and published_at", async () => {
    await settle(updateDraft({}, validForm({ intent: "publish" })));
    const live = recipeUpdates().find((u) => u.payload?.status === "live");
    expect(live).toBeDefined();
    expect(typeof live!.payload!.published_at).toBe("string");
  });

  it("publish on an already-live recipe does not change published_at", async () => {
    const original = "2026-01-02T03:04:05.000Z";
    state.fake.recipe = { ...draftRow, status: "live", published_at: original };
    await settle(updateDraft({}, validForm({ intent: "publish" })));
    const updates = recipeUpdates();
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
      if (!u.payload || !("published_at" in u.payload)) continue;
      const guarded =
        u.filters.some(([f, c, v]) => f === "eq" && c === "status" && v === "draft") ||
        u.filters.some(([f, c, v]) => f === "is" && c === "published_at" && v === null) ||
        u.payload.published_at === original;
      expect(guarded, JSON.stringify(u)).toBe(true);
    }
  });

  it("copies an outside cover image to storage on publish", async () => {
    const copied = "https://abc.supabase.co/storage/v1/object/public/recipe-images/paneer-tikka.jpg";
    copyCoverToStorage.mockResolvedValue(copied);
    await settle(updateDraft({}, validForm({ intent: "publish" })));
    expect(copyCoverToStorage).toHaveBeenCalledTimes(1);
    expect(copyCoverToStorage).toHaveBeenCalledWith(
      expect.objectContaining({ url: draftRow.cover_image_url, slug: "paneer-tikka" }),
    );
    expect(recipeUpdates().some((u) => u.payload?.cover_image_url === copied)).toBe(true);
  });

  it("a failed copy clears cover_image_url so there is no broken image", async () => {
    copyCoverToStorage.mockResolvedValue(null);
    await settle(updateDraft({}, validForm({ intent: "publish" })));
    expect(copyCoverToStorage).toHaveBeenCalledTimes(1);
    const withCover = recipeUpdates().filter((u) => u.payload && "cover_image_url" in u.payload);
    expect(withCover.length).toBeGreaterThan(0);
    expect(withCover.at(-1)!.payload!.cover_image_url).toBeNull();
  });

  it("does not copy a cover already on the Supabase storage host, nor on plain save", async () => {
    state.fake.recipe = {
      ...draftRow,
      cover_image_url: "https://abc.supabase.co/storage/v1/object/public/recipe-images/paneer-tikka.jpg",
    };
    await settle(updateDraft({}, validForm({ intent: "publish" })));
    expect(copyCoverToStorage).not.toHaveBeenCalled();

    state.fake.recipe = { ...draftRow };
    await settle(updateDraft({}, validForm({ intent: "save" })));
    expect(copyCoverToStorage).not.toHaveBeenCalled();
  });
});

describe("publishRecipe", () => {
  it("is removed (publishing goes through updateDraft intent=publish)", () => {
    expect((actions as Record<string, unknown>).publishRecipe).toBeUndefined();
  });
});
