import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { getChallenge, getCurrentChallenge, listChallenges } from "./challenges";

/*
 * Contract (server-only read model, src/lib/challenges/challenges.ts):
 *   getCurrentChallenge(supabase | null, today = nzToday()) -> Challenge | null
 *     the challenge with starts_on <= today <= ends_on, with baseRecipeSlug/Title from its live
 *     Shef base recipe (read through the given client: RLS hides drafts). Null without Supabase.
 *   listChallenges(supabase | null, today) -> { current, past }
 *     past = ends_on < today, newest first (by ends_on); upcoming challenges are not listed;
 *     each past challenge with a winner gets winner { remixId, authorName, photoUrl } from
 *     remix_feed (p_challenge_id) and signed photos. Without Supabase: { current: null, past: [] }.
 *   getChallenge(supabase | null, id, { admin, today }) -> ChallengeDetail | null
 *     null for a non-uuid id (no query), an unknown id, or no Supabase. Entries come from
 *     remix_feed with p_challenge_id = id, p_sort 'likes' for the admin and 'newest' otherwise;
 *     photos are signed with the same client; entries keep the feed order; isWinner flags
 *     winner_remix_id. open / ended use the NZ dates.
 *   The read model may query challenges with filters (eq/lte/gte/lt/gt/order/limit) or filter in
 *   code, and may embed the base recipe (`recipes(...)` or `alias:recipes(...)`) or read recipes
 *   separately; the fake below supports both.
 */

type Row = Record<string, unknown>;

const RECIPES: Row[] = [
  { id: "r-chai", slug: "masala-chai", title: "Masala Chai", source: "shef", status: "live" },
  { id: "r-tikka", slug: "paneer-tikka", title: "Paneer Tikka", source: "shef", status: "live" },
  { id: "r-draft", slug: "secret-curry", title: "Secret Curry", source: "shef", status: "draft" },
];

const C_ID = (n: number) => `c${n}c${n}c${n}c${n}-0000-4000-8000-00000000000${n}`;
const R_ID = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`.slice(0, 36);

const challengeRow = (n: number, startsOn: string, endsOn: string, extra: Row = {}): Row => ({
  id: C_ID(n),
  base_recipe_id: "r-chai",
  title: `Challenge ${n}`,
  description: `About ${n}`,
  starts_on: startsOn,
  ends_on: endsOn,
  winner_remix_id: null,
  created_at: `${startsOn}T00:00:00Z`,
  updated_at: `${startsOn}T00:00:00Z`,
  ...extra,
});

const feedRow = (n: number, challengeId: string, likes: number, createdAt: string, author = `Cook${n}`): Row => ({
  id: R_ID(n),
  recipe_id: "r-chai",
  recipe_slug: "masala-chai",
  recipe_title: "Masala Chai",
  challenge_id: challengeId,
  changes: `change ${n}`,
  photo_path: `u${n}/p${n}.jpg`,
  author_name: author,
  like_count: likes,
  created_at: createdAt,
});

type Call = { fn: string; args: Record<string, unknown> | undefined };

/** A small PostgREST-like fake: anon RLS on recipes (live Shef only), filters and embeds. */
/**
 * opts.seesDrafts models an admin session: RLS lets it read draft and outside recipes, so only an
 * embed filter (filter("base_recipe.status", "eq", "live")) keeps their slugs out.
 */
function fakeClient(challenges: Row[], feed: Row[] = [], opts: { seesDrafts?: boolean } = {}) {
  const rpcs: Call[] = [];
  const tables: string[] = [];
  const signed: string[][] = [];

  const visibleRecipes = () => (opts.seesDrafts ? RECIPES : RECIPES.filter((r) => r.source === "shef" && r.status === "live"));

  // PostgREST: filter("<embed>.<col>", "eq", v) on a to-one embed keeps the parent row and nulls
  // the embed when the embedded row does not match.
  const embedRecipe = (row: Row, select: string, embedFilters: [string, string, string, unknown][]): Row => {
    const m = select.match(/(?:(\w+)\s*:\s*)?recipes\s*(?:!\w+)?\s*\(/);
    if (!m) return row;
    const key = m[1] ?? "recipes";
    let r = visibleRecipes().find((x) => x.id === row.base_recipe_id) ?? null;
    for (const [embed, col, op, val] of embedFilters) {
      if (embed !== key || !r) continue;
      if (op === "eq" && r[col] !== val) r = null;
      else if (op === "neq" && r[col] === val) r = null;
    }
    return { ...row, [key]: r ? { id: r.id, slug: r.slug, title: r.title } : null };
  };

  const from = (table: string) => {
    tables.push(table);
    let select = "*";
    const preds: ((r: Row) => boolean)[] = [];
    const embedFilters: [string, string, string, unknown][] = [];
    const order: { col: string; asc: boolean }[] = [];
    let limit: number | null = null;
    const source = () => (table === "challenges" ? challenges : table === "recipes" ? visibleRecipes() : []);
    const run = () => {
      let rows = source().filter((r) => preds.every((p) => p(r)));
      for (const o of [...order].reverse()) {
        rows = [...rows].sort((a, b) => String(a[o.col]).localeCompare(String(b[o.col])) * (o.asc ? 1 : -1));
      }
      if (limit !== null) rows = rows.slice(0, limit);
      return table === "challenges" ? rows.map((r) => embedRecipe(r, select, embedFilters)) : rows;
    };
    const b: Record<string, unknown> = {};
    b.select = (s?: string) => {
      select = s ?? "*";
      return b;
    };
    const cmp = (op: (a: string, b: string) => boolean) => (col: string, val: unknown) => {
      preds.push((r) => r[col] !== null && r[col] !== undefined && op(String(r[col]), String(val)));
      return b;
    };
    b.eq = (col: string, val: unknown) => {
      preds.push((r) => r[col] === val);
      return b;
    };
    b.neq = (col: string, val: unknown) => {
      preds.push((r) => r[col] !== val);
      return b;
    };
    b.lt = cmp((a, v) => a < v);
    b.lte = cmp((a, v) => a <= v);
    b.gt = cmp((a, v) => a > v);
    b.gte = cmp((a, v) => a >= v);
    b.in = (col: string, vals: unknown[]) => {
      preds.push((r) => vals.includes(r[col]));
      return b;
    };
    b.is = (col: string, val: unknown) => {
      preds.push((r) => (r[col] ?? null) === val);
      return b;
    };
    b.not = () => b;
    b.filter = (path: string, op: string, val: unknown) => {
      const dot = path.indexOf(".");
      if (dot > 0) embedFilters.push([path.slice(0, dot), path.slice(dot + 1), op, val]);
      else if (op === "eq") preds.push((r) => r[path] === val);
      return b;
    };
    b.order = (col: string, opts?: { ascending?: boolean }) => {
      order.push({ col, asc: opts?.ascending ?? true });
      return b;
    };
    b.limit = (n: number) => {
      limit = n;
      return b;
    };
    b.range = (lo: number, hi: number) => {
      limit = hi - lo + 1;
      return b;
    };
    b.returns = () => b;
    b.maybeSingle = async () => ({ data: run()[0] ?? null, error: null });
    b.single = async () => {
      const r = run()[0];
      return r ? { data: r, error: null } : { data: null, error: { message: "not found", code: "PGRST116" } };
    };
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: run(), error: null }).then(res, rej);
    return b;
  };

  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    rpcs.push({ fn, args });
    if (fn !== "remix_feed") return { data: null, error: { message: `no fake for ${fn}` } };
    let rows = feed.filter((r) => !args?.p_challenge_id || r.challenge_id === args.p_challenge_id);
    rows = [...rows].sort((a, b) =>
      args?.p_sort === "likes"
        ? Number(b.like_count) - Number(a.like_count) || String(b.created_at).localeCompare(String(a.created_at))
        : String(b.created_at).localeCompare(String(a.created_at)),
    );
    const offset = Number(args?.p_offset ?? 0);
    const lim = Number(args?.p_limit ?? 24);
    return { data: rows.slice(offset, offset + lim), error: null };
  });

  const storage = {
    from: (_bucket: string) => ({
      createSignedUrls: async (paths: string[], expiresIn: number) => {
        signed.push(paths);
        return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?e=${expiresIn}`, error: null })), error: null };
      },
    }),
  };

  const client = { from: vi.fn(from), rpc, storage, auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
  return { client: client as unknown as SupabaseClient, rpcs, tables, signed };
}

const TODAY = "2026-11-18";

describe("challenge read model", () => {
  it("getCurrentChallenge returns the open challenge with its base recipe slug, or null", async () => {
    const rows = [
      challengeRow(1, "2026-11-02", "2026-11-08"),
      challengeRow(2, "2026-11-16", "2026-11-22", { title: "Chai your way", description: "Any milk you like" }),
      challengeRow(3, "2026-11-23", "2026-11-29"),
    ];
    const { client } = fakeClient(rows);
    const current = await getCurrentChallenge(client, TODAY);
    expect(current).toMatchObject({
      id: C_ID(2),
      title: "Chai your way",
      description: "Any milk you like",
      startsOn: "2026-11-16",
      endsOn: "2026-11-22",
      baseRecipeId: "r-chai",
      baseRecipeSlug: "masala-chai",
      baseRecipeTitle: "Masala Chai",
      winnerRemixId: null,
    });

    // first and last day are open (inclusive)
    expect((await getCurrentChallenge(client, "2026-11-16"))?.id).toBe(C_ID(2));
    expect((await getCurrentChallenge(client, "2026-11-22"))?.id).toBe(C_ID(2));
    // between challenges, and without Supabase
    expect(await getCurrentChallenge(client, "2026-11-12")).toBeNull();
    expect(await getCurrentChallenge(fakeClient([]).client, TODAY)).toBeNull();
    expect(await getCurrentChallenge(null, TODAY)).toBeNull();
  });

  it("getCurrentChallenge defaults to the NZ date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // 2026-11-22T11:30Z is Monday 23 November in NZ: challenge 3 is open, not 2
      vi.setSystemTime(new Date("2026-11-22T11:30:00Z"));
      const { client } = fakeClient([challengeRow(2, "2026-11-16", "2026-11-22"), challengeRow(3, "2026-11-23", "2026-11-29")]);
      expect((await getCurrentChallenge(client))?.id).toBe(C_ID(3));
    } finally {
      vi.useRealTimers();
    }
  });

  it("a base recipe that is no longer live gives no slug", async () => {
    const { client } = fakeClient([challengeRow(2, "2026-11-16", "2026-11-22", { base_recipe_id: "r-draft" })]);
    const current = await getCurrentChallenge(client, TODAY);
    expect(current?.id).toBe(C_ID(2));
    expect(current?.baseRecipeSlug).toBeNull();
    expect(JSON.stringify(current)).not.toContain("secret-curry");
  });

  it("listChallenges gives current then past, newest first", async () => {
    const rows = [
      challengeRow(1, "2026-10-26", "2026-11-01"),
      challengeRow(4, "2026-11-23", "2026-11-29"), // upcoming: not listed
      challengeRow(2, "2026-11-09", "2026-11-15", { base_recipe_id: "r-tikka", winner_remix_id: R_ID(7) }),
      challengeRow(3, "2026-11-16", "2026-11-22"),
      challengeRow(5, "2026-11-02", "2026-11-08"),
    ];
    const feed = [feedRow(7, C_ID(2), 9, "2026-11-10T01:00:00Z", "Priya"), feedRow(8, C_ID(2), 1, "2026-11-11T01:00:00Z")];
    const { client } = fakeClient(rows, feed);
    const list = await listChallenges(client, TODAY);
    expect(list.current?.id).toBe(C_ID(3));
    expect(list.past.map((c) => c.id)).toEqual([C_ID(2), C_ID(5), C_ID(1)]);
    expect(list.past[0].baseRecipeSlug).toBe("paneer-tikka");
    expect(list.past.map((c) => c.id)).not.toContain(C_ID(4));
    expect(list.current?.id).not.toBe(C_ID(4));
  });

  it("listChallenges fills the winner of past challenges and is empty without Supabase", async () => {
    const rows = [
      challengeRow(2, "2026-11-09", "2026-11-15", { winner_remix_id: R_ID(7) }),
      challengeRow(1, "2026-10-26", "2026-11-01"),
    ];
    const feed = [feedRow(7, C_ID(2), 9, "2026-11-10T01:00:00Z", "Priya"), feedRow(8, C_ID(2), 12, "2026-11-11T01:00:00Z")];
    const { client } = fakeClient(rows, feed);
    const list = await listChallenges(client, TODAY);
    expect(list.past[0].winner).toEqual({ remixId: R_ID(7), authorName: "Priya", photoUrl: expect.stringContaining("u7/p7.jpg") });
    expect(list.past[1].winner).toBeNull();
    expect(JSON.stringify(list)).not.toMatch(/user_id|email/);

    expect(await listChallenges(null, TODAY)).toEqual({ current: null, past: [] });
  });

  it("getChallenge gives entries newest first for visitors and by likes for the admin", async () => {
    const rows = [challengeRow(2, "2026-11-09", "2026-11-15")];
    const feed = [
      feedRow(1, C_ID(2), 2, "2026-11-10T01:00:00Z"),
      feedRow(2, C_ID(2), 9, "2026-11-11T01:00:00Z"),
      feedRow(3, C_ID(2), 5, "2026-11-12T01:00:00Z"),
      feedRow(9, C_ID(1), 50, "2026-11-12T02:00:00Z"), // another challenge's entry
    ];

    const visitor = fakeClient(rows, feed);
    const v = await getChallenge(visitor.client, C_ID(2), { today: TODAY });
    expect(v?.sort).toBe("newest");
    expect(v?.entries.map((e) => e.id)).toEqual([R_ID(3), R_ID(2), R_ID(1)]);
    expect(visitor.rpcs.find((c) => c.fn === "remix_feed")?.args).toMatchObject({ p_challenge_id: C_ID(2), p_sort: "newest" });

    const admin = fakeClient(rows, feed);
    const a = await getChallenge(admin.client, C_ID(2), { admin: true, today: TODAY });
    expect(a?.sort).toBe("likes");
    expect(a?.entries.map((e) => e.id)).toEqual([R_ID(2), R_ID(3), R_ID(1)]);
    expect(a?.entries.map((e) => e.likeCount)).toEqual([9, 5, 2]);
    expect(admin.rpcs.find((c) => c.fn === "remix_feed")?.args).toMatchObject({ p_challenge_id: C_ID(2), p_sort: "likes" });

    // photos are signed with the same client, and cards never carry user ids
    expect(a?.entries[0].photoUrl).toContain("u2/p2.jpg");
    expect(a?.entries[0]).toMatchObject({ authorName: "Cook2", changes: "change 2", recipeSlug: "masala-chai" });
    expect(admin.signed.flat()).toEqual(expect.arrayContaining(["u1/p1.jpg", "u2/p2.jpg", "u3/p3.jpg"]));

    expect(a).toMatchObject({ open: false, ended: true });
    expect(a?.challenge).toMatchObject({ id: C_ID(2), baseRecipeSlug: "masala-chai" });
  });

  it("the winner is flagged", async () => {
    const rows = [challengeRow(2, "2026-11-09", "2026-11-15", { winner_remix_id: R_ID(1) })];
    const feed = [feedRow(1, C_ID(2), 2, "2026-11-10T01:00:00Z", "Priya"), feedRow(2, C_ID(2), 9, "2026-11-11T01:00:00Z")];
    const { client } = fakeClient(rows, feed);
    const d = await getChallenge(client, C_ID(2), { today: TODAY });
    expect(d?.entries.find((e) => e.id === R_ID(1))?.isWinner).toBe(true);
    expect(d?.entries.find((e) => e.id === R_ID(2))?.isWinner).toBe(false);
    expect(d?.challenge.winnerRemixId).toBe(R_ID(1));
    expect(d?.challenge.winner).toMatchObject({ remixId: R_ID(1), authorName: "Priya" });
  });

  it("open and ended follow the NZ dates", async () => {
    const rows = [challengeRow(2, "2026-11-16", "2026-11-22")];
    const { client } = fakeClient(rows);
    expect(await getChallenge(client, C_ID(2), { today: "2026-11-22" })).toMatchObject({ open: true, ended: false });
    expect(await getChallenge(client, C_ID(2), { today: "2026-11-23" })).toMatchObject({ open: false, ended: true });
    expect(await getChallenge(client, C_ID(2), { today: "2026-11-10" })).toMatchObject({ open: false, ended: false });
  });

  it("getChallenge is null for an unknown or invalid id, or without Supabase", async () => {
    const f = fakeClient([challengeRow(2, "2026-11-09", "2026-11-15")]);
    expect(await getChallenge(f.client, "dddddddd-0000-4000-8000-000000000000", { today: TODAY })).toBeNull();
    const before = f.tables.length + f.rpcs.length;
    for (const bad of ["not-a-uuid", "", "1; drop table challenges", `${C_ID(2)}x`]) {
      expect(await getChallenge(f.client, bad, { today: TODAY })).toBeNull();
    }
    expect(f.tables.length + f.rpcs.length).toBe(before); // invalid ids never reach the database
    expect(await getChallenge(null, C_ID(2), { today: TODAY })).toBeNull();
  });
});

/* ---------- slice C review follow-ups ---------- */

describe("challenge read model review follow-ups", () => {
  it("the winner lookup calls remix_feed with p_challenge_id and p_remix_id (T1)", async () => {
    const rows = [challengeRow(2, "2026-11-09", "2026-11-15", { winner_remix_id: R_ID(7) })];
    const feed = [feedRow(7, C_ID(2), 9, "2026-11-10T01:00:00Z", "Priya"), feedRow(8, C_ID(2), 12, "2026-11-11T01:00:00Z")];
    const f = fakeClient(rows, feed);
    await listChallenges(f.client, TODAY);
    const winnerCalls = f.rpcs.filter((c) => c.fn === "remix_feed" && c.args?.p_remix_id !== undefined);
    expect(winnerCalls).toHaveLength(1);
    expect(winnerCalls[0].args).toMatchObject({ p_challenge_id: C_ID(2), p_remix_id: R_ID(7) });
  });

  it("an admin client that can see a draft base recipe gets baseRecipeSlug null and keeps the challenge (T2)", async () => {
    const rows = [
      challengeRow(2, "2026-11-16", "2026-11-22", { base_recipe_id: "r-draft" }),
      challengeRow(1, "2026-11-02", "2026-11-08", { base_recipe_id: "r-draft" }),
    ];
    const { client } = fakeClient(rows, [], { seesDrafts: true });

    const current = await getCurrentChallenge(client, TODAY);
    expect(current?.id).toBe(C_ID(2));
    expect(current?.baseRecipeSlug).toBeNull();
    expect(current?.baseRecipeTitle).toBeNull();

    const list = await listChallenges(client, TODAY);
    expect(list.current?.id).toBe(C_ID(2));
    expect(list.past.map((c) => c.id)).toEqual([C_ID(1)]);
    expect(list.past[0].baseRecipeSlug).toBeNull();

    const detail = await getChallenge(client, C_ID(2), { admin: true, today: TODAY });
    expect(detail?.challenge.id).toBe(C_ID(2));
    expect(detail?.challenge.baseRecipeSlug).toBeNull();
    expect(JSON.stringify([current, list, detail])).not.toMatch(/secret-curry|Secret Curry/);

    // a live base recipe is still embedded for the same admin client
    const live = fakeClient([challengeRow(3, "2026-11-16", "2026-11-22")], [], { seesDrafts: true });
    expect((await getCurrentChallenge(live.client, TODAY))?.baseRecipeSlug).toBe("masala-chai");
  });

  it("getChallenge says whether there are more entries than one page (N2)", async () => {
    const rows = [challengeRow(2, "2026-11-09", "2026-11-15")];
    const many = Array.from({ length: 30 }, (_, i) =>
      feedRow(i + 1, C_ID(2), i, `2026-11-10T${String(i % 24).padStart(2, "0")}:${String(i).padStart(2, "0")}:00Z`),
    );
    const full = await getChallenge(fakeClient(rows, many).client, C_ID(2), { today: TODAY });
    expect((full as { hasMore?: unknown } | null)?.hasMore).toBe(true);
    expect(full!.entries.length).toBeLessThan(30);

    const few = await getChallenge(fakeClient(rows, many.slice(0, 3)).client, C_ID(2), { today: TODAY });
    expect((few as { hasMore?: unknown } | null)?.hasMore).toBe(false);
    expect(few!.entries).toHaveLength(3);
  });
});
