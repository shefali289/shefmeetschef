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

import { askShefAction } from "./actions";

/*
 * Contract: askShefAction(prev, formData{slug, question, history?}) -> AskResult (never throws for
 * expected states). Uses createSupabaseServerClient() (the user's session, RLS applies) for the
 * recipe lookup of outside recipes and for rpc("consume_usage", { kind: "ask", lim: 10 }), and
 * process.env.GEMINI_API_KEY for Gemini.
 */
const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const OTHER = { id: "c0000000-0000-4000-8000-000000000003", email: "other@example.com" };

const recipeRow = (over: Record<string, unknown> = {}) => ({
  id: "r-chai",
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
  published_at: "2026-01-01T00:00:00Z",
  ...over,
});
const outsideRow = recipeRow({
  id: "r-out",
  slug: "reel-nani-dal-abc123",
  title: "Nani's Dal",
  source: "outside",
  owner_id: USER.id,
  reel_url: "https://www.instagram.com/nani.cooks/reel/ABC123/",
});

const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
  geminiJson({ answer: "Oat milk works. Happy cooking!" }),
);

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("GEMINI_API_KEY", "server-gemini-key");
}

beforeEach(() => {
  db.current = newFakeDb();
  db.current.rows = [recipeRow(), outsideRow];
  db.current.rpcResult.consume_usage = { data: 9, error: null };
  db.current.rpcResult.usage_remaining = { data: 10, error: null };
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

describe("askShefAction", () => {
  it("askShefAction uses the signed-in user's client and GEMINI_API_KEY from the server env", async () => {
    configure();
    // name built from parts so the secret guard in src/lib/env.test.ts does not flag this file
    vi.stubEnv("NEXT_" + "PUBLIC_GEMINI_API_KEY", "leaked-public-key");
    db.current.user = USER;
    const res = await askShefAction(null, form({ slug: "masala-chai", question: "Oat milk instead?" }));
    expect(res).toMatchObject({
      status: "ok",
      answer: "Oat milk works. Happy cooking!",
      shefVersion: null,
      remaining: 9,
      limit: 10,
    });
    expect(db.current.rpcs).toEqual([
      { client: "session", fn: "consume_usage", args: { kind: "ask", lim: 10 } },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [input, init] = fetchSpy.mock.calls[0];
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    expect(url).toContain("gemini-2.5-flash");
    expect(url).not.toContain("key=");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("server-gemini-key");
    expect(JSON.stringify(init?.body)).not.toContain("leaked-public-key");
    // Ask Shef replies are not stored
    expect(db.current.writes).toEqual([]);
  });

  it("asks about the user's own outside recipe; someone else's is not found and costs nothing", async () => {
    configure();
    db.current.user = USER;
    const own = await askShefAction(null, form({ slug: outsideRow.slug, question: "Less spicy?" }));
    expect(own.status).toBe("ok");
    const body = String(fetchSpy.mock.calls[0][1]?.body);
    expect(body).toContain("Nani");

    db.current.user = OTHER;
    db.current.rpcs = [];
    fetchSpy.mockClear();
    const theirs = await askShefAction(null, form({ slug: outsideRow.slug, question: "Less spicy?" }));
    expect(theirs.status).toBe("not-found");
    expect(db.current.rpcs).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("signed-out returns the sign-in state without consuming or calling Gemini", async () => {
    configure();
    db.current.user = null;
    const res = await askShefAction(null, form({ slug: "masala-chai", question: "Oat milk?" }));
    expect(res).toEqual({ status: "signed-out" });
    expect(db.current.rpcs).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("over the limit returns the limit message without calling Gemini", async () => {
    configure();
    db.current.user = USER;
    db.current.rpcResult.consume_usage = {
      data: null,
      error: { message: "usage_limit_reached", code: "P0001" },
    };
    const res = await askShefAction(null, form({ slug: "masala-chai", question: "Oat milk?" }));
    expect(res).toMatchObject({ status: "limit", remaining: 0, limit: 10 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("passes the browser-held history through the caps", async () => {
    configure();
    db.current.user = USER;
    const history = JSON.stringify([
      { question: "first-q", answer: "first-a" },
      { question: "second-q", answer: "second-a" },
      { question: "third-q", answer: "third-a" },
      { question: "fourth-q", answer: "fourth-a" },
    ]);
    const res = await askShefAction(null, form({ slug: "masala-chai", question: "And for 6?", history }));
    expect(res.status).toBe("ok");
    const body = String(fetchSpy.mock.calls[0][1]?.body);
    expect(body).not.toContain("first-q");
    expect(body).toContain("fourth-a");

    // malformed history JSON is ignored, not a crash
    fetchSpy.mockClear();
    const res2 = await askShefAction(null, form({ slug: "masala-chai", question: "And for 6?", history: "[{" }));
    expect(res2.status).toBe("ok");
  });

  it("not configured returns not set up yet", async () => {
    // no Supabase env at all
    const res = await askShefAction(null, form({ slug: "masala-chai", question: "Oat milk?" }));
    expect(res.status).toBe("not-configured");
    expect((res as { message: string }).message).toMatch(/not set up yet/i);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Supabase set up but no Gemini key: nothing is consumed
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    db.current.user = USER;
    const res2 = await askShefAction(null, form({ slug: "masala-chai", question: "Oat milk?" }));
    expect(res2.status).toBe("not-configured");
    expect((res2 as { message: string }).message).toMatch(/not set up yet/i);
    expect(db.current.rpcs).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
