import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DraftValidationError, GeminiError, type DraftRecipe } from "./gemini-parser";
import type { InstagramPost } from "./instagram";
import type { YouTubePost } from "./youtube";
import { runImport as runImportBase, type DraftRow, type ExistingIds, type ImportDeps } from "./run-import";

/*
 * Contract additions (review findings):
 *   deps.maxParses?: number (default 3): parseCaption is never called more than this per run.
 *   deps.recordSkip({source, id, reason: "no_recipe" | "failed"}): records posts that should not be
 *     parsed again (no-recipe captions and failed parses).
 *   existingIds() may also return skipped: {instagram: Set, youtube: Set}; those posts are not parsed.
 *   summary.remaining: new posts not processed this run (over maxParses).
 *   summary.sourceErrors: [{source, error}] when a fetcher rejects; the other source still imports.
 */
type SkipRecord = { source: "instagram" | "youtube"; id: string; reason: "no_recipe" | "failed" };
type ExtraDeps = {
  maxParses?: number;
  recordSkip: (s: SkipRecord) => Promise<void>;
};
type Existing = ExistingIds & { skipped?: { instagram: Set<string>; youtube: Set<string> } };
type Deps = Omit<ImportDeps, "existingIds"> & ExtraDeps & { existingIds: () => Promise<Existing> };
type Summary = Awaited<ReturnType<typeof runImportBase>> & {
  remaining: number;
  sourceErrors: { source: "instagram" | "youtube"; error: string }[];
};
const runImport = (deps: Deps) => runImportBase(deps as unknown as ImportDeps) as Promise<Summary>;

function ig(id: string, caption = `Recipe ${id}\n1 cup rice`): InstagramPost {
  return {
    instagram_id: id,
    caption,
    permalink: `https://www.instagram.com/reel/${id}/`,
    thumbnail_url: `https://cdninstagram.example/t/${id}.jpg`,
    media_type: "VIDEO",
    timestamp: "2026-10-01T10:00:00+0000",
  };
}

function yt(id: string, title = `Video ${id}`): YouTubePost {
  return {
    youtube_id: id,
    title,
    description: `Ingredients for ${id}: 2 cups flour`,
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    published_at: "2026-10-05T12:00:00Z",
  };
}

function draft(title: string): DraftRecipe {
  return {
    title,
    description: "Tasty.",
    ingredients: [{ qty: 1, unit: "cup", item: "rice", note: null }],
    steps: [{ text: "Cook it." }],
    base_servings: 2,
    prep_minutes: 5,
    cook_minutes: 10,
    cuisine: "indian",
    diet_tags: ["vegetarian"],
    allergens: [],
    categories: ["healthy"],
  };
}

function makeDeps(over: Partial<Deps> & { existing?: Partial<Existing> } = {}) {
  const saved: DraftRow[] = [];
  const { existing, ...rest } = over;
  const deps: Deps = {
    recordSkip: vi.fn(async (_s: SkipRecord) => {}),
    fetchInstagram: vi.fn(async () => [] as InstagramPost[]),
    fetchYouTube: vi.fn(async () => [] as YouTubePost[]),
    parseCaption: vi.fn(async (caption: string) => draft(caption.split("\n")[0])),
    existingIds: vi.fn(async () => ({
      instagram: new Set<string>(),
      youtube: new Set<string>(),
      slugs: new Set<string>(),
      ...existing,
    })),
    saveDraft: vi.fn(async (row: DraftRow) => {
      saved.push(row);
    }),
    ...rest,
  };
  return { deps, saved };
}

describe("runImport", () => {
  it("skips posts whose instagram_id/youtube_id already exist", async () => {
    const { deps, saved } = makeDeps({
      fetchInstagram: async () => [ig("ig-old"), ig("ig-new")],
      fetchYouTube: async () => [yt("yt-old"), yt("yt-new")],
      existing: { instagram: new Set(["ig-old"]), youtube: new Set(["yt-old"]) },
    });
    const summary = await runImport(deps);
    expect(saved.map((r) => r.instagram_id ?? r.youtube_id).sort()).toEqual(["ig-new", "yt-new"]);
    expect(summary.skipped).toBe(2);
    // skipped posts are not even sent to Gemini (saves free-tier quota)
    expect(deps.parseCaption).toHaveBeenCalledTimes(2);
  });

  it("saves parsed posts as status draft, source shef with reel_url/youtube_url and cover_image_url from thumbnail", async () => {
    const { deps, saved } = makeDeps({
      fetchInstagram: async () => [ig("ig1", "Masala Chai\n1 cup milk")],
      fetchYouTube: async () => [yt("yt1", "Veg Biryani")],
      parseCaption: vi.fn(async (caption: string) =>
        draft(caption.includes("Masala") ? "Masala Chai" : "Veg Biryani"),
      ),
    });
    await runImport(deps);
    expect(saved).toHaveLength(2);
    const igRow = saved.find((r) => r.instagram_id === "ig1")!;
    const ytRow = saved.find((r) => r.youtube_id === "yt1")!;

    expect(igRow).toMatchObject({
      status: "draft",
      source: "shef",
      published_at: null,
      reel_url: "https://www.instagram.com/reel/ig1/",
      youtube_url: null,
      youtube_id: null,
      cover_image_url: "https://cdninstagram.example/t/ig1.jpg",
      title: "Masala Chai",
      slug: "masala-chai",
      ingredients: [{ qty: 1, unit: "cup", item: "rice", note: null }],
      steps: [{ text: "Cook it." }],
      base_servings: 2,
      cuisine: "indian",
      diet_tags: ["vegetarian"],
      categories: ["healthy"],
    });
    expect(ytRow).toMatchObject({
      status: "draft",
      source: "shef",
      published_at: null,
      reel_url: null,
      instagram_id: null,
      youtube_url: "https://www.youtube.com/watch?v=yt1",
      cover_image_url: "https://i.ytimg.com/vi/yt1/hqdefault.jpg",
      title: "Veg Biryani",
    });
    // YouTube: the parser sees the title and description
    const ytCaption = vi
      .mocked(deps.parseCaption)
      .mock.calls.map((c) => c[0])
      .find((c) => c.includes("Ingredients for yt1"));
    expect(ytCaption).toBeDefined();
    expect(ytCaption).toContain("Veg Biryani");
  });

  it("skips captions with no recipe and reports them", async () => {
    const { deps, saved } = makeDeps({
      fetchInstagram: async () => [ig("ig1", "Happy Diwali!"), ig("ig2", "Dal\n1 cup lentils")],
      parseCaption: vi.fn(async (caption: string) =>
        caption.startsWith("Happy") ? ({ noRecipe: true } as const) : draft("Dal"),
      ),
    });
    const summary = await runImport(deps);
    expect(saved.map((r) => r.instagram_id)).toEqual(["ig2"]);
    expect(summary.noRecipe).toEqual([
      { source: "instagram", id: "ig1", url: "https://www.instagram.com/reel/ig1/" },
    ]);
    expect(summary.imported).toBe(1);
  });

  it("a failed parse for one post does not stop others and is reported", async () => {
    const { deps, saved } = makeDeps({
      fetchInstagram: async () => [ig("ig1", "Bad"), ig("ig2", "Good\n1 cup")],
      fetchYouTube: async () => [yt("yt1", "Also good")],
      parseCaption: vi.fn(async (caption: string) => {
        if (caption.startsWith("Bad")) throw new Error("Gemini exploded");
        return draft(caption.split("\n")[0]);
      }),
    });
    const summary = await runImport(deps);
    expect(saved.map((r) => r.instagram_id ?? r.youtube_id).sort()).toEqual(["ig2", "yt1"]);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toMatchObject({
      source: "instagram",
      id: "ig1",
      url: "https://www.instagram.com/reel/ig1/",
    });
    expect(summary.failed[0].error).toMatch(/Gemini exploded/);
  });

  it("a failed save is reported and does not stop others", async () => {
    let calls = 0;
    const { deps } = makeDeps({
      fetchInstagram: async () => [ig("ig1"), ig("ig2")],
      saveDraft: vi.fn(async () => {
        calls++;
        if (calls === 1) throw new Error("duplicate key");
      }),
    });
    const summary = await runImport(deps);
    expect(deps.saveDraft).toHaveBeenCalledTimes(2);
    expect(summary.imported).toBe(1);
    expect(summary.failed).toHaveLength(1);
  });

  it("generates unique slugs", async () => {
    const { deps, saved } = makeDeps({
      fetchInstagram: async () => [ig("ig1"), ig("ig2")],
      fetchYouTube: async () => [yt("yt1")],
      parseCaption: vi.fn(async () => draft("Masala Chai")),
      existing: { slugs: new Set(["masala-chai"]) },
    });
    await runImport(deps);
    expect(saved.map((r) => r.slug).sort()).toEqual([
      "masala-chai-2",
      "masala-chai-3",
      "masala-chai-4",
    ]);
  });

  it("returns a summary {imported, skipped, noRecipe, failed}", async () => {
    const { deps } = makeDeps({
      maxParses: 10,
      fetchInstagram: async () => [ig("old"), ig("ok1"), ig("none", "hello"), ig("boom", "boom")],
      fetchYouTube: async () => [yt("ok2")],
      existing: { instagram: new Set(["old"]) },
      parseCaption: vi.fn(async (caption: string) => {
        if (caption === "hello") return { noRecipe: true } as const;
        if (caption === "boom") throw new DraftValidationError("bad output");
        return draft("Something");
      }),
    });
    const summary = await runImport(deps);
    expect(summary).toEqual({
      imported: 2,
      skipped: 1,
      remaining: 0,
      sourceErrors: [],
      noRecipe: [{ source: "instagram", id: "none", url: "https://www.instagram.com/reel/none/" }],
      failed: [
        {
          source: "instagram",
          id: "boom",
          url: "https://www.instagram.com/reel/boom/",
          error: expect.stringContaining("bad output"),
        },
      ],
    });
  });

  it("works when YouTube is not configured", async () => {
    const { deps, saved } = makeDeps({
      fetchInstagram: async () => [ig("ig1")],
      fetchYouTube: undefined,
    });
    const summary = await runImport(deps);
    expect(saved).toHaveLength(1);
    expect(summary.imported).toBe(1);
    expect(summary.failed).toEqual([]);
  });

  it("imports nothing and saves nothing when there are no new posts", async () => {
    const { deps } = makeDeps();
    const summary = await runImport(deps);
    expect(summary).toEqual({
      imported: 0,
      skipped: 0,
      remaining: 0,
      noRecipe: [],
      failed: [],
      sourceErrors: [],
    });
    expect(deps.saveDraft).not.toHaveBeenCalled();
  });

  it("never calls parseCaption more than maxParses times and reports remaining", async () => {
    const posts = Array.from({ length: 8 }, (_, i) => ig(`ig${i}`));
    const { deps, saved } = makeDeps({ fetchInstagram: async () => posts, maxParses: 3 });
    const summary = await runImport(deps);
    expect(deps.parseCaption).toHaveBeenCalledTimes(3);
    expect(saved).toHaveLength(3);
    expect(summary.imported).toBe(3);
    expect(summary.remaining).toBe(5);
  });

  it("maxParses defaults to 3", async () => {
    const posts = Array.from({ length: 9 }, (_, i) => ig(`ig${i}`));
    const { deps } = makeDeps({
      fetchInstagram: async () => posts,
      fetchYouTube: async () => [yt("yt1"), yt("yt2")],
    });
    const summary = await runImport(deps);
    expect(deps.parseCaption).toHaveBeenCalledTimes(3);
    expect(summary.remaining).toBe(8);
  });

  it("already-imported posts do not use up maxParses", async () => {
    const { deps } = makeDeps({
      fetchInstagram: async () => [ig("old1"), ig("old2"), ig("new1"), ig("new2")],
      existing: { instagram: new Set(["old1", "old2"]) },
      maxParses: 2,
    });
    const summary = await runImport(deps);
    expect(summary).toMatchObject({ imported: 2, skipped: 2, remaining: 0 });
  });

  it("records no-recipe and failed-parse posts with recordSkip", async () => {
    const { deps } = makeDeps({
      maxParses: 10,
      fetchInstagram: async () => [ig("none", "hello"), ig("boom", "boom"), ig("ok")],
      fetchYouTube: async () => [yt("ytnone", "nothing")],
      parseCaption: vi.fn(async (caption: string) => {
        if (caption === "hello" || caption.startsWith("nothing")) return { noRecipe: true } as const;
        if (caption === "boom") throw new DraftValidationError("bad output");
        return draft("Fine");
      }),
    });
    await runImport(deps);
    const records = vi.mocked(deps.recordSkip).mock.calls.map((c) => c[0]);
    expect(records).toHaveLength(3);
    expect(records).toEqual(
      expect.arrayContaining([
        { source: "instagram", id: "none", reason: "no_recipe" },
        { source: "instagram", id: "boom", reason: "failed" },
        { source: "youtube", id: "ytnone", reason: "no_recipe" },
      ]),
    );
  });

  it("transient Gemini errors are reported but not recorded, so the post is retried", async () => {
    const { deps } = makeDeps({
      fetchInstagram: async () => [ig("busy", "busy"), ig("slow", "slow")],
      fetchYouTube: async () => [],
      parseCaption: vi.fn(async (caption: string) => {
        if (caption === "busy") throw new GeminiError("rate limited", 429);
        throw new Error("The operation was aborted due to timeout");
      }),
    });
    const summary = await runImport(deps);
    expect(summary.failed).toHaveLength(2);
    expect(deps.recordSkip).not.toHaveBeenCalled();
  });

  it("posts recorded as skipped earlier are not parsed again", async () => {
    const { deps, saved } = makeDeps({
      fetchInstagram: async () => [ig("skipme"), ig("fresh")],
      fetchYouTube: async () => [yt("ytskip")],
      existing: { skipped: { instagram: new Set(["skipme"]), youtube: new Set(["ytskip"]) } },
    });
    const summary = await runImport(deps);
    expect(deps.parseCaption).toHaveBeenCalledTimes(1);
    expect(saved.map((r) => r.instagram_id)).toEqual(["fresh"]);
    expect(summary.skipped).toBe(2);
    expect(deps.recordSkip).not.toHaveBeenCalled();
  });

  it("one source failing still imports the other and is reported in sourceErrors", async () => {
    const { deps, saved } = makeDeps({
      fetchInstagram: async () => [ig("ig1")],
      fetchYouTube: async () => {
        throw new Error("quotaExceeded");
      },
    });
    const summary = await runImport(deps);
    expect(saved.map((r) => r.instagram_id)).toEqual(["ig1"]);
    expect(summary.imported).toBe(1);
    expect(summary.sourceErrors).toEqual([{ source: "youtube", error: expect.stringContaining("quotaExceeded") }]);

    const other = makeDeps({
      fetchInstagram: async () => {
        throw new Error("token expired");
      },
      fetchYouTube: async () => [yt("yt1")],
    });
    const s2 = await runImport(other.deps);
    expect(other.saved.map((r) => r.youtube_id)).toEqual(["yt1"]);
    expect(s2.sourceErrors).toEqual([{ source: "instagram", error: expect.stringContaining("token expired") }]);
  });
});
