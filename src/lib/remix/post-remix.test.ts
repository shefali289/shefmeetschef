import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { postRemix, type DbError, type PostRemixDeps, type PostRemixInput, type RemixInsertRow, type RemixRecipe } from "./post-remix";

/*
 * Contract (src/lib/remix/post-remix.ts, server-only): postRemix(input, deps) -> PostRemixResult
 *   input: { userId (null when signed out), slug, photoPath, changes } straight from the form.
 * Order: signed in? -> changes 1..2000 (trimmed) and photo path "<userId>/<uuid>.(jpg|png|webp)",
 *   before any Storage call -> recipe by slug on the server (live Shef only, else not-found) ->
 *   download the photo with the user's session and sniff its bytes (JPEG/PNG/WebP only; anything
 *   else is removed) -> insert ONLY { recipe_id, photo_path, changes } (the trigger sets user,
 *   status, challenge and spends the remix) -> usage_remaining for the counter.
 * Failures after the upload remove the user's photo: limit (SMU01 usage_limit_reached -> "0 of 5
 *   remixes left today"), banned ("can't post"), any other insert error ("try again").
 *   A photo path that is not the user's own is never downloaded or removed.
 * Success: { status: "pending", id, message: "Thanks! Waiting for a quick check", remaining, limit: 5 }.
 */

const USER = "b0000000-0000-4000-8000-000000000002";
const OTHER = "c0000000-0000-4000-8000-000000000003";
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PATH = `${USER}/${UUID}.jpg`;
const RECIPE: RemixRecipe = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "masala-chai",
  title: "Masala Chai",
  source: "shef",
  status: "live",
};
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
const HTML = new TextEncoder().encode("<!DOCTYPE html><script>alert(1)</script>");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');

const RLS_ERROR: DbError = { code: "42501", message: 'new row violates row-level security policy for table "remixes"' };
const LIMIT_ERROR: DbError = { code: "SMU01", message: "usage_limit_reached" };

function deps(over: Partial<PostRemixDeps> = {}) {
  const order: string[] = [];
  const defaults = {
    findRecipe: vi.fn(async (_slug: string): Promise<RemixRecipe | null> => {
      order.push("findRecipe");
      return RECIPE;
    }),
    download: vi.fn(async (_path: string): Promise<Uint8Array | null> => {
      order.push("download");
      return JPEG;
    }),
    removePhoto: vi.fn(async (_path: string) => {
      order.push("removePhoto");
    }),
    insertRemix: vi.fn(async (_row: RemixInsertRow): Promise<{ id: string } | { error: DbError }> => {
      order.push("insert");
      return { id: "remix-1" };
    }),
    remaining: vi.fn(async () => {
      order.push("remaining");
      return 2;
    }),
    isBanned: vi.fn(async () => {
      order.push("isBanned");
      return false;
    }),
  };
  const d = { ...defaults, ...over } as typeof defaults;
  return { d, order };
}

const input = (over: Partial<PostRemixInput> = {}): PostRemixInput => ({
  userId: USER,
  slug: "masala-chai",
  photoPath: PATH,
  changes: "Used oat milk and less sugar.",
  ...over,
});

function expectNoStorageOrInsert(d: ReturnType<typeof deps>["d"]) {
  expect(d.download).not.toHaveBeenCalled();
  expect(d.removePhoto).not.toHaveBeenCalled();
  expect(d.insertRemix).not.toHaveBeenCalled();
}

describe("postRemix", () => {
  it("signed-out returns sign-in state", async () => {
    const { d } = deps();
    await expect(postRemix(input({ userId: null }), d)).resolves.toEqual({ status: "signed-out" });
    expectNoStorageOrInsert(d);
    expect(d.findRecipe).not.toHaveBeenCalled();
  });

  it("rejects empty or over-2000 changes before touching storage", async () => {
    for (const changes of ["", "   \n", "x".repeat(2001), null, undefined, 123]) {
      const { d } = deps();
      const res = await postRemix(input({ changes }), d);
      expect(res.status).toBe("invalid");
      expect((res as { errors: { changes?: string } }).errors.changes).toEqual(expect.any(String));
      expectNoStorageOrInsert(d);
    }
    // exactly 2000 (after trimming) is fine, and the trimmed text is what gets stored
    const { d } = deps();
    const res = await postRemix(input({ changes: `  ${"y".repeat(2000)}  ` }), d);
    expect(res.status).toBe("pending");
    expect(d.insertRemix.mock.calls[0][0].changes).toBe("y".repeat(2000));
  });

  it("rejects a photo path outside the user's folder", async () => {
    for (const photoPath of [
      `${OTHER}/${UUID}.jpg`,
      `${USER}/../${OTHER}/${UUID}.jpg`,
      `${USER}/${UUID}.gif`,
      `${USER}/sub/${UUID}.jpg`,
      `remix-photos/${USER}/${UUID}.jpg`,
      `${USER}/not-a-uuid.jpg`,
      "",
      null,
      undefined,
      ["x"],
    ]) {
      const { d } = deps();
      const res = await postRemix(input({ photoPath }), d);
      expect({ photoPath, status: res.status }).toEqual({ photoPath, status: "invalid" });
      expect((res as { errors: { photo?: string } }).errors.photo).toEqual(expect.any(String));
      // someone else's file is never read, and never deleted
      expectNoStorageOrInsert(d);
    }
  });

  it("loads the recipe by slug on the server, and outside or unknown slugs are not found", async () => {
    const { d } = deps();
    await postRemix(input(), d);
    expect(d.findRecipe).toHaveBeenCalledWith("masala-chai");
    // the recipe id comes from the server lookup, never from the browser
    expect(d.insertRemix.mock.calls[0][0].recipe_id).toBe(RECIPE.id);

    const notShef: (RemixRecipe | null)[] = [
      null,
      { ...RECIPE, source: "outside" },
      { ...RECIPE, status: "draft" },
    ];
    for (const recipe of notShef) {
      const { d: d2 } = deps({ findRecipe: vi.fn(async () => recipe) });
      const res = await postRemix(input(), d2);
      expect({ recipe, status: res.status }).toEqual({ recipe, status: "not-found" });
      expect((res as { message: string }).message).toEqual(expect.any(String));
      expect(d2.insertRemix).not.toHaveBeenCalled();
    }
  });

  it("downloads the photo and rejects and removes a file whose bytes are not JPEG, PNG or WebP", async () => {
    const ok = deps();
    await postRemix(input(), ok.d);
    expect(ok.d.download).toHaveBeenCalledWith(PATH);
    expect(ok.order.indexOf("download")).toBeLessThan(ok.order.indexOf("insert"));

    for (const [name, bytes] of [
      ["gif", GIF],
      ["html", HTML],
      ["svg", SVG],
      ["empty", new Uint8Array(0)],
    ] as const) {
      const { d } = deps({ download: vi.fn(async () => bytes) });
      const res = await postRemix(input(), d);
      expect({ name, status: res.status }).toEqual({ name, status: "invalid" });
      expect((res as { errors: { photo?: string } }).errors.photo).toMatch(/JPEG|PNG|WebP|photo/i);
      expect(d.removePhoto).toHaveBeenCalledWith(PATH);
      expect(d.insertRemix).not.toHaveBeenCalled();
    }

    // the upload never arrived: nothing to insert
    const { d } = deps({ download: vi.fn(async () => null) });
    const res = await postRemix(input(), d);
    expect(res.status).toBe("invalid");
    expect(d.insertRemix).not.toHaveBeenCalled();
  });

  it("inserts only recipe_id, photo_path and changes", async () => {
    const { d } = deps();
    await postRemix(
      input({ changes: "  less sugar  " }) as PostRemixInput & Record<string, unknown>,
      d,
    );
    expect(d.insertRemix).toHaveBeenCalledTimes(1);
    const row = d.insertRemix.mock.calls[0][0];
    expect(Object.keys(row).sort()).toEqual(["changes", "photo_path", "recipe_id"]);
    expect(row).toEqual({ recipe_id: RECIPE.id, photo_path: PATH, changes: "less sugar" });

    // extra fields smuggled into the input never reach the row
    const sneaky = deps();
    await postRemix(
      { ...input(), status: "approved", user_id: OTHER, challenge_id: UUID } as unknown as PostRemixInput,
      sneaky.d,
    );
    const sneakyRow = sneaky.d.insertRemix.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(sneakyRow).sort()).toEqual(["changes", "photo_path", "recipe_id"]);
  });

  it("limit reached removes the photo and returns the 0 of 5 message", async () => {
    for (const error of [LIMIT_ERROR, { code: "P0001", message: "usage_limit_reached" }]) {
      const { d } = deps({ insertRemix: vi.fn(async () => ({ error })) });
      const res = await postRemix(input(), d);
      expect(res).toMatchObject({ status: "limit", remaining: 0, limit: 5 });
      expect((res as { message: string }).message).toContain("0 of 5 remixes left today");
      expect((res as { message: string }).message).toMatch(/come back tomorrow/i);
      expect(d.removePhoto).toHaveBeenCalledWith(PATH);
    }
  });

  it("banned returns the can't-post message and removes the photo", async () => {
    const { d } = deps({
      insertRemix: vi.fn(async () => ({ error: RLS_ERROR })),
      isBanned: vi.fn(async () => true),
    });
    const res = await postRemix(input(), d);
    expect(res.status).toBe("banned");
    expect((res as { message: string }).message).toMatch(/can[’']t post|cannot post/i);
    expect((res as { message: string }).message).not.toMatch(/row-level|42501|policy/i);
    expect(d.removePhoto).toHaveBeenCalledWith(PATH);
    expect(d.insertRemix.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("other insert errors remove the photo and say try again", async () => {
    for (const error of [
      RLS_ERROR, // e.g. the recipe stopped being live between the lookup and the insert
      { code: "23505", message: 'duplicate key value violates unique constraint "remixes_photo_path_key"' },
      { code: "23514", message: 'new row violates check constraint "remixes_complete"' },
      { message: "fetch failed" },
    ]) {
      const { d } = deps({ insertRemix: vi.fn(async () => ({ error })) });
      const res = await postRemix(input(), d);
      expect({ code: error.code, status: res.status }).toEqual({ code: error.code, status: "error" });
      const message = (res as { message: string }).message;
      expect(message).toMatch(/try again/i);
      expect(message).not.toMatch(/violates|constraint|policy|fetch failed/i);
      expect(d.removePhoto).toHaveBeenCalledWith(PATH);
    }
  });

  it("returns pending with Waiting for a quick check and the remaining count", async () => {
    const { d, order } = deps();
    const res = await postRemix(input(), d);
    expect(res).toEqual({
      status: "pending",
      id: "remix-1",
      message: expect.stringMatching(/Thanks! Waiting for a quick check/),
      remaining: 2,
      limit: 5,
    });
    // the counter is read after the insert spent the remix; the photo stays
    expect(order.indexOf("insert")).toBeLessThan(order.lastIndexOf("remaining"));
    expect(d.removePhoto).not.toHaveBeenCalled();
    expect(d.insertRemix).toHaveBeenCalledTimes(1);
  });

  /* ---------- slice B review finding NIT1 ---------- */
  it("NIT1: a recipe lookup that throws says try again, removes the photo and inserts nothing", async () => {
    const { d } = deps({
      findRecipe: vi.fn(async () => {
        throw new Error("Could not load recipes: fetch failed");
      }),
    });
    const res = await postRemix(input(), d);
    expect(res.status).toBe("error");
    const message = (res as { message: string }).message;
    expect(message).toMatch(/try again/i);
    expect(message).not.toMatch(/fetch failed|Could not load/);
    expect(d.removePhoto).toHaveBeenCalledWith(PATH);
    expect(d.insertRemix).not.toHaveBeenCalled();
    expect(d.download).not.toHaveBeenCalled();
  });
});
