import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCookbook, loadCookbook, type CookbookRecipe, type FolderRow, type SaveRow } from "./cookbook";

/*
 * Contract (src/lib/cookbook/cookbook.ts):
 *   buildCookbook({ saves, folders, reels = [], limit? = 30 }) -> Cookbook
 *     all:     saves of non-outside recipes, newest first
 *     folders: every folder (empty too) sorted by name (case-insensitive), items = saves filed there
 *              (outside recipes included: "My reels" recipes can be filed into folders)
 *     myReels: built from `reels`, the user's OWN outside recipes (source 'outside', owner_id = user),
 *              not from saves (review B2). A reel the user unsaved still shows (saveId null,
 *              folderId null). If a save exists for a reel, its saveId and folderId are used, so it
 *              still filters into its folder. Newest first.
 *     unavailable: saves whose recipe is null (deleted or no longer visible, e.g. moved back to
 *              draft), as [{ saveId }] so the user can remove them (review B1).
 *     used:    non-outside saves + unavailable saves (matches the DB trigger); limit: 30
 *   loadCookbook(supabase, userId) reads `saves` (joined as `recipe`), `folders`, and `recipes`
 *   filtered to source = 'outside' and owner_id = userId, with the given client.
 */

/** One of the user's own outside recipes, as loadCookbook reads it from `recipes`. */
type Reel = CookbookRecipe & { created_at: string };
function reel(n: number): Reel {
  return { ...recipe(n, "outside"), created_at: `2026-11-${String(n).padStart(2, "0")}T00:00:00Z` };
}

const F_DESSERTS = "f0000000-0000-4000-8000-000000000001";
const F_BREAKFAST = "f0000000-0000-4000-8000-000000000002";
const F_CURRIES = "f0000000-0000-4000-8000-000000000003";

function recipe(n: number, source: "shef" | "outside" = "shef"): CookbookRecipe {
  return {
    id: `r0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    slug: source === "outside" ? `reel-dish-${n}-abc123` : `dish-${n}`,
    title: `Dish ${n}`,
    cover_image_url: null,
    source,
  };
}

function save(n: number, opts: { folder?: string | null; source?: "shef" | "outside"; day?: number } = {}): SaveRow {
  return {
    id: `s0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    folder_id: opts.folder ?? null,
    created_at: `2026-11-${String(opts.day ?? n).padStart(2, "0")}T00:00:00Z`,
    recipe: recipe(n, opts.source),
  };
}

const folders: FolderRow[] = [
  { id: F_DESSERTS, name: "Desserts" },
  { id: F_BREAKFAST, name: "breakfast" },
  { id: F_CURRIES, name: "Curries" },
];

describe("buildCookbook", () => {
  it("groups saves into All saves and per folder", () => {
    const saves = [save(1, { folder: F_DESSERTS }), save(2), save(3, { folder: F_CURRIES }), save(4, { folder: F_DESSERTS })];
    const book = buildCookbook({ saves, folders });

    // All saves holds every (non-outside) save, filed or not, newest first.
    expect(book.all.map((i) => i.recipe.slug)).toEqual(["dish-4", "dish-3", "dish-2", "dish-1"]);
    expect(book.all[0]).toMatchObject({ saveId: saves[3].id, folderId: F_DESSERTS, savedAt: saves[3].created_at });

    const byId = Object.fromEntries(book.folders.map((f) => [f.id, f]));
    expect(byId[F_DESSERTS].items.map((i) => i.recipe.slug).sort()).toEqual(["dish-1", "dish-4"]);
    expect(byId[F_CURRIES].items.map((i) => i.recipe.slug)).toEqual(["dish-3"]);
    // Empty folders are still listed.
    expect(byId[F_BREAKFAST].items).toEqual([]);
    // A save is in at most one folder.
    const filed = book.folders.flatMap((f) => f.items.map((i) => i.saveId));
    expect(new Set(filed).size).toBe(filed.length);
  });

  it("outside recipes go to My reels and are not counted", () => {
    const saves = [save(1), save(2, { source: "outside" }), save(3, { source: "outside", folder: F_DESSERTS })];
    const book = buildCookbook({ saves, folders, reels: [reel(2), reel(3)] });

    expect(book.myReels.map((i) => i.recipe.slug)).toEqual(["reel-dish-3-abc123", "reel-dish-2-abc123"]);
    expect(book.all.map((i) => i.recipe.slug)).toEqual(["dish-1"]);
    expect(book.used).toBe(1);
    // A reel filed into a folder shows in that folder too.
    const desserts = book.folders.find((f) => f.id === F_DESSERTS)!;
    expect(desserts.items.map((i) => i.recipe.slug)).toEqual(["reel-dish-3-abc123"]);
  });

  it("counts used saves for the counter", () => {
    const saves = [
      ...Array.from({ length: 12 }, (_, i) => save(i + 1, { folder: i % 2 ? F_CURRIES : null })),
      save(20, { source: "outside" }),
      save(21, { source: "outside" }),
      // A save whose recipe is gone (or no longer visible) still counts in the DB trigger, so it
      // counts here too and is listed as unavailable so the user can remove it.
      { ...save(22), recipe: null },
    ];
    const book = buildCookbook({ saves, folders, reels: [reel(20), reel(21)] });
    expect(book.used).toBe(13);
    expect(book.limit).toBe(30);
    expect(book.all).toHaveLength(12);
    expect(book.myReels).toHaveLength(2);
    expect(book.unavailable).toEqual([{ saveId: saves[14].id }]);
    expect(buildCookbook({ saves: [], folders: [] })).toMatchObject({
      used: 0,
      limit: 30,
      all: [],
      myReels: [],
      folders: [],
      unavailable: [],
    });
  });

  it("unavailable saves are listed for removal and never shown as recipes", () => {
    const gone = [
      { ...save(5, { folder: F_DESSERTS }), recipe: null },
      { ...save(6), recipe: null },
    ];
    const book = buildCookbook({ saves: [save(1), ...gone], folders });
    expect(book.unavailable.map((u) => u.saveId).sort()).toEqual(gone.map((g) => g.id).sort());
    expect(book.used).toBe(3);
    expect(book.all.map((i) => i.saveId)).toEqual([save(1).id]);
    expect(book.folders.flatMap((f) => f.items)).toEqual([]);
  });

  it("My reels comes from the user's own outside recipes, saved or not", () => {
    // reel 2 is saved and filed in Desserts; reel 3 was unsaved; reel 4 was never saved
    const saves = [save(1), save(2, { source: "outside", folder: F_DESSERTS })];
    const book = buildCookbook({ saves, folders, reels: [reel(2), reel(3), reel(4)] });

    expect(book.myReels.map((i) => i.recipe.slug)).toEqual([
      "reel-dish-4-abc123",
      "reel-dish-3-abc123",
      "reel-dish-2-abc123",
    ]);
    const unsaved = book.myReels.find((i) => i.recipe.slug === "reel-dish-3-abc123")!;
    expect(unsaved).toMatchObject({ saveId: null, folderId: null });
    const filed = book.myReels.find((i) => i.recipe.slug === "reel-dish-2-abc123")!;
    expect(filed).toMatchObject({ saveId: saves[1].id, folderId: F_DESSERTS });
    // the saved reel still filters into its folder
    const desserts = book.folders.find((f) => f.id === F_DESSERTS)!;
    expect(desserts.items.map((i) => i.recipe.slug)).toEqual(["reel-dish-2-abc123"]);
    // reels never count, saved or not, and never appear in All saves
    expect(book.used).toBe(1);
    expect(book.all.map((i) => i.recipe.slug)).toEqual(["dish-1"]);
  });

  it("a saved outside recipe that is not one of the user's reels is not in My reels", () => {
    // e.g. an admin who saved someone else's reel: it counts like any other save (DB rule N3)
    const saves = [save(1), save(9, { source: "outside" })];
    const book = buildCookbook({ saves, folders, reels: [] });
    expect(book.myReels).toEqual([]);
  });

  it("folders are sorted by name", () => {
    const book = buildCookbook({ saves: [], folders });
    expect(book.folders.map((f) => f.name)).toEqual(["breakfast", "Curries", "Desserts"]);
  });

  it("ignores saves filed into a folder that is not the user's", () => {
    const stranger = "f0000000-0000-4000-8000-0000000000ff";
    const book = buildCookbook({ saves: [save(1, { folder: stranger })], folders });
    expect(book.folders.flatMap((f) => f.items)).toEqual([]);
    expect(book.all).toHaveLength(1);
  });
});

const USER_ID = "b0000000-0000-4000-8000-000000000002";

describe("loadCookbook", () => {
  it("reads saves and folders with the given (user's) client", async () => {
    const tables: string[] = [];
    const filters: Record<string, [string, unknown][]> = {};
    const rows: Record<string, unknown[]> = {
      saves: [save(1, { folder: F_DESSERTS }), save(2, { source: "outside" })],
      folders: [{ id: F_DESSERTS, name: "Desserts" }],
      recipes: [reel(2), reel(3)],
    };
    const builder = (table: string) => {
      const b: Record<string, unknown> = {};
      filters[table] ??= [];
      for (const m of ["select", "order", "is", "not", "limit"]) b[m] = () => b;
      b.eq = (col: string, val: unknown) => {
        filters[table].push([col, val]);
        return b;
      };
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows[table] ?? [], error: null }).then(res, rej);
      return b;
    };
    const supabase = {
      from: vi.fn((t: string) => {
        tables.push(t);
        return builder(t);
      }),
    } as unknown as SupabaseClient;

    const book = await loadCookbook(supabase, USER_ID);
    expect(tables).toEqual(expect.arrayContaining(["saves", "folders", "recipes"]));
    // My reels: only the user's own outside recipes
    expect(filters.recipes).toContainEqual(["source", "outside"]);
    expect(filters.recipes).toContainEqual(["owner_id", USER_ID]);
    expect(book.used).toBe(1);
    expect(book.myReels.map((i) => i.recipe.slug).sort()).toEqual(["reel-dish-2-abc123", "reel-dish-3-abc123"]);
    expect(book.folders[0].items).toHaveLength(1);
  });

  it("throws when the database read fails", async () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "is", "not", "limit"]) b[m] = () => b;
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: { message: "boom" } }).then(res, rej);
    const supabase = { from: () => b } as unknown as SupabaseClient;
    await expect(loadCookbook(supabase, USER_ID)).rejects.toThrow();
  });
});
