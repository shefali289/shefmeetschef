import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostRemixDeps } from "@/lib/remix/post-remix";
import type { PostRemixResult } from "@/lib/remix/types";

vi.mock("server-only", () => ({}));

/*
 * Task 3 slice D contract (src/app/recipes/[slug]/remix/actions.ts wiring):
 * - With GEMINI_API_KEY set, postRemixAction passes postRemix a `moderate` dep that calls
 *   moderateRemix(input, { apiKey: GEMINI_API_KEY, fetch }) from @/lib/remix/moderate.
 *   Without it, `moderate` is left out (no Gemini call; the remix stays pending).
 * - It always passes `applyVerdict`, which calls applyAiVerdict(id, verdict) from
 *   @/lib/supabase/service (that returns null itself when the service key is missing).
 * - "approved" and "hidden" results revalidate /recipes/<slug> and /remixes, like "pending".
 */

const { captured, postRemix } = vi.hoisted(() => {
  const captured: { deps: PostRemixDeps | null; result: PostRemixResult } = {
    deps: null,
    result: { status: "pending", id: "remix-1", message: "Thanks! Waiting for a quick check", remaining: 4, limit: 5 },
  };
  return {
    captured,
    postRemix: vi.fn(async (_input: unknown, deps: PostRemixDeps) => {
      captured.deps = deps;
      return captured.result;
    }),
  };
});
vi.mock("@/lib/remix/post-remix", () => ({
  postRemix,
  REMIX_NOT_FOUND_TEXT: "We couldn't find that recipe.",
}));
const { moderateRemix } = vi.hoisted(() => ({ moderateRemix: vi.fn(async () => ({ verdict: "approve", reason: "Food" })) }));
vi.mock("@/lib/remix/moderate", () => ({ moderateRemix, MODERATION_TIMEOUT_MS: 8000, MODERATION_REASON_MAX: 200 }));
const { applyAiVerdict } = vi.hoisted(() => ({ applyAiVerdict: vi.fn(async () => "approved") }));
vi.mock("@/lib/supabase/service", () => ({ applyAiVerdict }));
vi.mock("@/lib/recipes", () => ({
  SLUG_RE: /^[a-z0-9]+(-[a-z0-9]+)*$/,
  getRecipeBySlug: vi.fn(async () => null),
}));

const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const sessionClient = {
  auth: { getUser: vi.fn(async () => ({ data: { user: USER }, error: null })) },
  from: vi.fn(),
  rpc: vi.fn(async () => ({ data: 4, error: null })),
  storage: { from: vi.fn(() => ({ download: vi.fn(), remove: vi.fn() })) },
};
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => sessionClient) }));
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

import { postRemixAction } from "./actions";

const goodForm = () => {
  const fd = new FormData();
  fd.set("slug", "masala-chai");
  fd.set("photo_path", `${USER.id}/0f8fad5b-d9cb-469f-a165-70867728950e.jpg`);
  fd.set("changes", "Oat milk");
  return fd;
};
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  captured.deps = null;
  captured.result = { status: "pending", id: "remix-1", message: "Thanks! Waiting for a quick check", remaining: 4, limit: 5 };
  postRemix.mockClear();
  moderateRemix.mockClear();
  applyAiVerdict.mockClear();
  revalidatePath.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("postRemixAction moderation wiring", () => {
  it("passes a moderate dep that calls Gemini with the server key", async () => {
    await postRemixAction(null, goodForm());
    expect(captured.deps?.moderate).toEqual(expect.any(Function));
    const input = { photo: { bytes: JPEG, mimeType: "image/jpeg" as const }, changes: "Oat milk" };
    await expect(captured.deps!.moderate!(input)).resolves.toEqual({ verdict: "approve", reason: "Food" });
    expect(moderateRemix).toHaveBeenCalledWith(input, expect.objectContaining({ apiKey: "test-gemini-key", fetch: expect.any(Function) }));
  });

  it("applies the verdict through the service path", async () => {
    await postRemixAction(null, goodForm());
    expect(captured.deps?.applyVerdict).toEqual(expect.any(Function));
    await expect(captured.deps!.applyVerdict!("remix-1", { verdict: "reject", reason: "Not food" })).resolves.toBe("approved");
    expect(applyAiVerdict).toHaveBeenCalledWith("remix-1", { verdict: "reject", reason: "Not food" });
  });

  it("without GEMINI_API_KEY there is no moderate dep, so the remix stays pending", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await postRemixAction(null, goodForm());
    expect(postRemix).toHaveBeenCalledTimes(1);
    expect(captured.deps?.moderate).toBeUndefined();
    expect(moderateRemix).not.toHaveBeenCalled();
  });

  it("approved and hidden results revalidate the recipe page and /remixes", async () => {
    for (const result of [
      { status: "approved", id: "remix-1", message: "Your remix is live!", remaining: 4, limit: 5 },
      { status: "hidden", id: "remix-1", message: "Sorry...", reason: "Not food", remaining: 4, limit: 5 },
    ] as PostRemixResult[]) {
      revalidatePath.mockClear();
      captured.result = result;
      await expect(postRemixAction(null, goodForm())).resolves.toEqual(result);
      expect(revalidatePath).toHaveBeenCalledWith("/recipes/masala-chai");
      expect(revalidatePath).toHaveBeenCalledWith("/remixes");
    }
  });
});
