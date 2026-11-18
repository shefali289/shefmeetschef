import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeClient, newFakeDb, type FakeDb } from "@/test/fake-supabase-rls";

vi.mock("server-only", () => ({}));

/*
 * Contract (src/app/recipes/[slug]/remix/actions.ts, "use server"):
 *   postRemixAction(prev, formData{ slug, photo_path, changes }) -> RemixFormState
 * - Not configured (no Supabase env): { status: "not-configured", message: "...not set up yet..." }.
 * - Signed out: redirect to /sign-in?next=<encoded /recipes/<slug>/remix>.
 * - Wires postRemix to the signed-in user's own session client: the recipe is loaded by slug on
 *   the server, the photo is downloaded from remix-photos with the session, the insert into
 *   `remixes` uses the session and carries only recipe_id, photo_path and changes, and the counter
 *   comes from usage_remaining('remix', 5). consume_usage is never called (the insert spends it).
 * - On success revalidates /recipes/<slug> and /remixes.
 */

const { db } = vi.hoisted(() => ({ db: { current: null as unknown as FakeDb } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !db.current) return null;
    db.current.sessionClients++;
    return makeFakeClient(db.current, "session");
  }),
}));
vi.mock("@supabase/supabase-js", async (orig) => ({
  ...(await orig<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(() => makeFakeClient(db.current ?? newFakeDb(), "anon")),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  }),
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  }),
}));

import { revalidatePath } from "next/cache";
import { postRemixAction } from "./actions";

const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PATH = `${USER.id}/${UUID}.jpg`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

const shefRow = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "masala-chai",
  title: "Masala Chai",
  description: null,
  reel_url: null,
  youtube_url: null,
  cover_image_url: null,
  source: "shef",
  owner_id: null,
  ingredients: [{ qty: 1, unit: "cup", item: "milk" }],
  steps: [{ text: "Boil." }],
  base_servings: 2,
  prep_minutes: 2,
  cook_minutes: 8,
  cuisine: "indian",
  diet_tags: ["vegetarian"],
  allergens: ["milk"],
  categories: ["drinks"],
  status: "live",
  published_at: "2026-11-01T00:00:00Z",
};

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const goodForm = (over: Record<string, string> = {}) =>
  form({ slug: "masala-chai", photo_path: PATH, changes: "Oat milk and less sugar.", ...over });

function withSupabase(user: typeof USER | null) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  db.current = newFakeDb();
  db.current.rows = [shefRow];
  db.current.user = user;
  db.current.objects[`remix-photos/${PATH}`] = JPEG;
  db.current.rpcResult.usage_remaining = { data: 4, error: null };
  db.current.rpcResult.is_banned = { data: false, error: null };
}

beforeEach(() => vi.mocked(revalidatePath).mockClear());
afterEach(() => {
  vi.unstubAllEnvs();
  db.current = null as unknown as FakeDb;
});

describe("postRemixAction", () => {
  it("postRemixAction uses the signed-in user's client", async () => {
    withSupabase(USER);
    const res = await postRemixAction(null, goodForm({ user_id: "c0000000-0000-4000-8000-000000000003", status: "approved" }));
    expect(res).toMatchObject({ status: "pending", remaining: 4, limit: 5 });
    expect((res as { message: string }).message).toMatch(/Waiting for a quick check/);

    const inserts = db.current.writes.filter((w) => w.table === "remixes");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ client: "session", method: "insert" });
    const payload = (Array.isArray(inserts[0].payload) ? inserts[0].payload[0] : inserts[0].payload) as Record<string, unknown>;
    expect(payload).toEqual({ recipe_id: shefRow.id, photo_path: PATH, changes: "Oat milk and less sugar." });

    // the photo was read with the session, from the private bucket
    const downloads = db.current.storage.filter((s) => s.method === "download");
    expect(downloads).toEqual([{ client: "session", bucket: "remix-photos", method: "download", args: [PATH] }]);
    // the counter is read, never spent from the app (the insert trigger spends it)
    expect(db.current.rpcs.filter((r) => r.fn === "consume_usage")).toEqual([]);
    const counter = db.current.rpcs.find((r) => r.fn === "usage_remaining");
    expect(counter).toMatchObject({ client: "session", args: { kind: "remix", lim: 5 } });
    // nothing was written through an anon client
    expect(db.current.writes.filter((w) => w.client !== "session")).toEqual([]);
  });

  it("signed-out redirects to sign-in with next /recipes/<slug>/remix", async () => {
    withSupabase(null);
    const err = (await postRemixAction(null, goodForm()).catch((e: unknown) => e)) as { digest?: string };
    expect(err.digest).toBe(`NEXT_REDIRECT;/sign-in?next=${encodeURIComponent("/recipes/masala-chai/remix")}`);
    expect(db.current.writes).toEqual([]);
    expect(db.current.storage).toEqual([]);

    // a made-up slug never becomes an open redirect
    // (it may be refused as not found before the redirect, or redirect to a safe same-site page)
    const bad = (await postRemixAction(null, goodForm({ slug: "//evil.example" })).catch((e: unknown) => e)) as {
      digest?: string;
      status?: string;
    };
    if (bad.digest) {
      const next = new URLSearchParams(bad.digest.split("?")[1]).get("next") ?? "";
      expect(next.startsWith("/")).toBe(true);
      expect(next.startsWith("//")).toBe(false);
      expect(next).not.toContain("evil.example");
    } else {
      expect(bad.status).not.toBe("pending");
    }
    expect(db.current.writes).toEqual([]);
  });

  it("not configured returns not set up yet", async () => {
    db.current = newFakeDb();
    const res = await postRemixAction(null, goodForm());
    expect(res).toMatchObject({ status: "not-configured" });
    expect((res as { message: string }).message).toMatch(/not set up yet/i);
    expect(db.current.sessionClients).toBe(0);
  });

  it("revalidates the recipe page and /remixes", async () => {
    withSupabase(USER);
    await postRemixAction(null, goodForm());
    expect(revalidatePath).toHaveBeenCalledWith("/recipes/masala-chai");
    expect(revalidatePath).toHaveBeenCalledWith("/remixes");

    // nothing is revalidated when the post is refused
    vi.mocked(revalidatePath).mockClear();
    const res = await postRemixAction(null, goodForm({ changes: "   " }));
    expect(res?.status).toBe("invalid");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a slug that is not a live Shef recipe is not found", async () => {
    withSupabase(USER);
    const res = await postRemixAction(null, goodForm({ slug: "no-such-recipe" }));
    expect(res?.status).toBe("not-found");
    expect(db.current.writes.filter((w) => w.table === "remixes")).toEqual([]);
  });
});
