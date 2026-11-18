import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { DraftRecipe } from "@/lib/import/gemini-parser";
import { GeminiError } from "@/lib/import/gemini-parser";
import { FREE_LIMITS } from "@/lib/limits";
import { LimitReachedError } from "@/lib/usage";
import { addReel, CAPTION_MAX_LENGTH, type AddReelDeps, type OutsideRecipeRow } from "./add-reel";

const USER = "b0000000-0000-4000-8000-000000000002";
const URL_WITH_HANDLE = "https://www.instagram.com/nani.cooks/reel/C5mAsalaCh1/?igsh=abc&utm_source=ig";
const CANONICAL = "https://www.instagram.com/nani.cooks/reel/C5mAsalaCh1/";
const CAPTION = "Masala chai! 1 cup water, 1 cup milk, 2 tsp tea. Boil, simmer, strain.";

const DRAFT: DraftRecipe = {
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

function deps(over: Partial<AddReelDeps> = {}) {
  const order: string[] = [];
  let n = 0;
  const defaults = {
    remaining: vi.fn(async () => {
      order.push("remaining");
      return 3;
    }),
    consume: vi.fn(async () => {
      order.push("consume");
      return 2;
    }),
    parse: vi.fn(async (_caption: string) => {
      order.push("parse");
      return DRAFT as Awaited<ReturnType<AddReelDeps["parse"]>>;
    }),
    insertRecipe: vi.fn(async (_row: OutsideRecipeRow) => {
      order.push("insert");
      return { id: "rec-1" } as { id: string } | "slug-taken";
    }),
    saveToCookbook: vi.fn(async (_id: string) => {
      order.push("save");
    }),
    randomSuffix: vi.fn(() => ["abc123", "def456", "ghi789", "jkl012", "mno345"][n++ % 5]),
  };
  const d = { ...defaults, ...over } as typeof defaults;
  return { d, order };
}

const input = (over: Partial<{ url: string; caption: string }> = {}) => ({
  userId: USER,
  url: URL_WITH_HANDLE,
  caption: CAPTION,
  ...over,
});

function expectNothingSpent(d: ReturnType<typeof deps>["d"]) {
  expect(d.consume).not.toHaveBeenCalled();
  expect(d.insertRecipe).not.toHaveBeenCalled();
  expect(d.saveToCookbook).not.toHaveBeenCalled();
}

describe("addReel", () => {
  it("rejects non-Instagram or malformed links", async () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://instagram.com.evil.io/reel/ABC123/",
      "https://www.instagram.com/nani.cooks/",
      "https://www.instagram.com/bad-handle!/reel/ABC123/",
      "javascript:alert(1)//www.instagram.com/reel/ABC123/",
      "not a url",
      "",
    ]) {
      const { d } = deps();
      const res = await addReel(input({ url }), d);
      expect(res.status, url).toBe("invalid");
      expect((res as { errors: { url?: string } }).errors.url, url).toBeTruthy();
      expect(d.parse).not.toHaveBeenCalled();
      expectNothingSpent(d);
    }
  });

  it("rejects empty captions and captions over 2200 characters", async () => {
    for (const caption of ["", "   \n ", "x".repeat(CAPTION_MAX_LENGTH + 1)]) {
      const { d } = deps();
      const res = await addReel(input({ caption }), d);
      expect(res.status).toBe("invalid");
      expect((res as { errors: { caption?: string } }).errors.caption).toBeTruthy();
      expect(d.parse).not.toHaveBeenCalled();
      expectNothingSpent(d);
    }
    expect(CAPTION_MAX_LENGTH).toBe(2200);
    const { d } = deps();
    const ok = await addReel(input({ caption: "x".repeat(CAPTION_MAX_LENGTH) }), d);
    expect(ok.status).toBe("ok");
  });

  it("stores the canonical link only, never video", async () => {
    const { d } = deps();
    await addReel(input(), d);
    const row = d.insertRecipe.mock.calls[0][0];
    expect(row.reel_url).toBe(CANONICAL);
    expect(row.youtube_url).toBeNull();
    expect(row.cover_image_url).toBeNull();
    expect(row.instagram_id).toBeNull();
    expect(row.youtube_id).toBeNull();
    for (const key of Object.keys(row)) expect(key).not.toMatch(/video|media|thumbnail/i);
    // the caption itself is not stored either
    expect(JSON.stringify(row)).not.toContain("2 tsp tea. Boil, simmer, strain.");
  });

  it("no remaining reels returns the limit message without calling Gemini", async () => {
    const { d } = deps({ remaining: vi.fn(async () => 0) });
    const res = await addReel(input(), d);
    expect(res).toMatchObject({ status: "limit", remaining: 0, limit: FREE_LIMITS.outside_reel });
    expect((res as { message: string }).message).toMatch(/0 of 5 left this month/);
    expect(d.remaining).toHaveBeenCalledWith("outside_reel", 5);
    expect(d.parse).not.toHaveBeenCalled();
    expectNothingSpent(d);
  });

  it("no recipe found returns the message and does not consume", async () => {
    const { d } = deps({ parse: vi.fn(async () => ({ noRecipe: true as const })) });
    const res = await addReel(input(), d);
    expect(res.status).toBe("no-recipe");
    expect((res as { message: string }).message).toMatch(/no recipe found in that caption/i);
    expect(res).toMatchObject({ remaining: 3 });
    expectNothingSpent(d);
  });

  it("Gemini failure returns a try-again message and does not consume", async () => {
    const { d } = deps({
      parse: vi.fn(async () => {
        throw new GeminiError("quota", 429);
      }),
    });
    const res = await addReel(input(), d);
    expect(res.status).toBe("error");
    expect((res as { message: string }).message).toMatch(/try again/i);
    expectNothingSpent(d);
  });

  it("consumes outside_reel only after a recipe is found", async () => {
    const { d, order } = deps();
    await addReel(input(), d);
    expect(order).toEqual(["remaining", "parse", "consume", "insert", "save"]);
    expect(d.consume).toHaveBeenCalledTimes(1);
    expect(d.consume).toHaveBeenCalledWith("outside_reel", 5);

    // a parallel request used the last reel: consume raises, nothing is inserted
    const race = deps({
      consume: vi.fn(async () => {
        throw new LimitReachedError("outside_reel", 5);
      }),
    });
    const res = await addReel(input(), race.d);
    expect(res).toMatchObject({ status: "limit", remaining: 0 });
    expect(race.d.insertRecipe).not.toHaveBeenCalled();
    expect(race.d.saveToCookbook).not.toHaveBeenCalled();
  });

  it("inserts source outside, status live, owner = user, slug reel-...", async () => {
    const { d } = deps();
    await addReel(input(), d);
    const row = d.insertRecipe.mock.calls[0][0];
    expect(row).toMatchObject({
      source: "outside",
      status: "live",
      owner_id: USER,
      title: "Masala Chai",
      ingredients: DRAFT.ingredients,
      steps: DRAFT.steps,
      base_servings: 2,
      diet_tags: ["vegetarian"],
      allergens: ["milk"],
    });
    expect(row.slug).toBe("reel-masala-chai-abc123");
    expect(row.slug).toMatch(/^reel-[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{6}$/);
    expect(row.slug.length).toBeLessThanOrEqual(100);
  });

  it("uses a random 6-character suffix by default", async () => {
    const { d } = deps();
    delete (d as Partial<typeof d>).randomSuffix;
    await addReel(input(), d);
    const slug = d.insertRecipe.mock.calls[0][0].slug;
    expect(slug).toMatch(/^reel-masala-chai-[a-z0-9]{6}$/);
  });

  it("retries with a new suffix on a slug conflict", async () => {
    const insertRecipe = vi
      .fn(async (_row: OutsideRecipeRow): Promise<{ id: string } | "slug-taken"> => ({ id: "rec-2" }))
      .mockResolvedValueOnce("slug-taken");
    const { d } = deps({ insertRecipe });
    const res = await addReel(input(), d);
    expect(insertRecipe).toHaveBeenCalledTimes(2);
    const [first, second] = insertRecipe.mock.calls.map((c) => c[0].slug);
    expect(first).toBe("reel-masala-chai-abc123");
    expect(second).toBe("reel-masala-chai-def456");
    expect(res).toEqual({ status: "ok", slug: "reel-masala-chai-def456", remaining: 2 });
    expect(d.consume).toHaveBeenCalledTimes(1); // one reel, however many tries

    // gives up after a few tries instead of looping forever
    const always = vi.fn(async (): Promise<{ id: string } | "slug-taken"> => "slug-taken");
    const stuck = deps({ insertRecipe: always });
    const out = await addReel(input(), stuck.d);
    expect(out.status).toBe("error");
    expect(always.mock.calls.length).toBeGreaterThan(1);
    expect(always.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("saves it unfiled into the cookbook", async () => {
    const { d } = deps();
    await addReel(input(), d);
    expect(d.saveToCookbook).toHaveBeenCalledTimes(1);
    expect(d.saveToCookbook).toHaveBeenCalledWith("rec-1");
  });

  it("returns the slug and remaining count", async () => {
    const { d } = deps();
    await expect(addReel(input(), d)).resolves.toEqual({
      status: "ok",
      slug: "reel-masala-chai-abc123",
      remaining: 2,
    });
  });
});
