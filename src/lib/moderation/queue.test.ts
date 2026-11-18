import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
import { buildQueue, countWaitingRemixes, loadBannedUsers, loadModerationQueue, type QueueRemixRow, type QueueReportRow } from "./queue";

/*
 * Contract (src/lib/moderation/queue.ts, server-only; reads with the ADMIN's own session client,
 * so RLS applies: admins read every remix, report, ban and profile):
 *   buildQueue({ remixes, reports, bannedUserIds }) -> QueueItem[]   (pure)
 *     The queue holds: every 'pending' remix; every 'hidden' remix with hidden_by 'reports'; and
 *     every 'approved' remix with at least one report made after its reports_cleared_at (all reports
 *     when null). Remixes hidden by the AI, the admin or a ban, and approved remixes with no new
 *     reports, are left out. Oldest first (created_at).
 *     QueueItem = { id, userId, authorName (profile name, else "A home cook"), recipeTitle,
 *       recipeSlug, photoPath, changes, status, hiddenBy, aiVerdict, aiReason,
 *       reportCount (reports since reports_cleared_at), reportReasons (their non-blank reasons),
 *       createdAt, authorBanned }
 *   QueueRemixRow is a remixes row with the embedded recipes (title, slug) and profiles (name).
 *   loadModerationQueue(supabase) -> { items: QueueItem[]; failed: boolean } (never throws).
 *     Slice D review B3: bounded reads only.
 *       - remix_reports is never read on its own; reports come embedded in the remixes select
 *         ("remix_reports(...)"), and no id.in list is built from report ids.
 *       - one remixes query for .or("status.eq.pending,hidden_by.eq.reports"), and one for
 *         .eq("status", "approved") with the reports embedded as "remix_reports!inner(...)"
 *         (approved remixes that have reports); each query has a .limit(n), n <= 500.
 *       - bans read for authorBanned. Items = buildQueue of the rows and their embedded reports.
 *     Any read error (or throw) gives { items: [], failed: true }, so the page can say
 *     "Couldn't load the queue" rather than "Nothing to check".
 *   loadBannedUsers(supabase) -> [{ userId, name, reason, createdAt }] newest ban first. Reads
 *     `bans` and the banned users' `profiles` (bans has two foreign keys to profiles, so names are
 *     matched by id rather than embedded); no name -> "A home cook".
 *   countWaitingRemixes(supabase) -> how many remixes loadModerationQueue would list, or null
 *     when it failed (never 0 on error; the admin home then shows no count).
 */

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const C = "c0000000-0000-4000-8000-00000000000c";

const remixRow = (id: string, over: Partial<QueueRemixRow> = {}): QueueRemixRow => ({
  id,
  user_id: A,
  recipe_id: "11111111-1111-4111-8111-111111111111",
  photo_path: `${A}/${id}.jpg`,
  changes: `changes for ${id}`,
  status: "pending",
  ai_verdict: null,
  ai_reason: null,
  ai_checked_at: null,
  hidden_by: null,
  reports_cleared_at: null,
  moderated_at: null,
  challenge_id: null,
  created_at: "2026-11-18T01:00:00Z",
  recipes: { title: "Masala Chai", slug: "masala-chai" },
  profiles: { name: "Priya Sharma" },
  ...over,
});
const reportRow = (remix_id: string, user_id: string, created_at: string, reason: string | null = null): QueueReportRow => ({
  remix_id,
  user_id,
  reason,
  created_at,
});

const REMIXES: QueueRemixRow[] = [
  remixRow("p-new", { created_at: "2026-11-18T05:00:00Z", ai_verdict: "review", ai_reason: "Unsure the photo is food" }),
  remixRow("p-old", { created_at: "2026-11-17T05:00:00Z" }), // never checked (Gemini down)
  remixRow("h-rep", { status: "hidden", hidden_by: "reports", created_at: "2026-11-16T05:00:00Z", ai_verdict: "approve", ai_reason: "Food" }),
  remixRow("h-ai", { status: "hidden", hidden_by: "ai", ai_verdict: "reject", ai_reason: "Not food" }),
  remixRow("h-admin", { status: "hidden", hidden_by: "admin" }),
  remixRow("h-ban", { status: "hidden", hidden_by: "ban", user_id: C, profiles: { name: null } }),
  remixRow("a-quiet", { status: "approved" }),
  remixRow("a-old-reports", { status: "approved", reports_cleared_at: "2026-11-15T00:00:00Z" }),
  remixRow("a-reported", { status: "approved", created_at: "2026-11-17T09:00:00Z", reports_cleared_at: "2026-11-15T00:00:00Z", user_id: B, profiles: null }),
];
const REPORTS: QueueReportRow[] = [
  reportRow("h-rep", A, "2026-11-17T00:00:00Z", "Not a real dish"),
  reportRow("h-rep", B, "2026-11-17T01:00:00Z", null),
  reportRow("h-rep", C, "2026-11-17T02:00:00Z", "  "),
  reportRow("a-old-reports", B, "2026-11-14T00:00:00Z", "old"), // before the admin's review
  reportRow("a-reported", A, "2026-11-14T00:00:00Z", "before review"),
  reportRow("a-reported", C, "2026-11-16T00:00:00Z", "Spam link"),
];

describe("moderation queue", () => {
  it("lists pending and report-hidden remixes oldest first with report counts, reasons and the AI reason", () => {
    const q = buildQueue({ remixes: REMIXES, reports: REPORTS, bannedUserIds: [] });
    expect(q.map((i) => i.id)).toEqual(["h-rep", "p-old", "a-reported", "p-new"]);
    const byId = Object.fromEntries(q.map((i) => [i.id, i]));
    expect(byId["h-rep"]).toMatchObject({
      status: "hidden",
      hiddenBy: "reports",
      reportCount: 3,
      reportReasons: ["Not a real dish"],
      aiReason: "Food",
      recipeTitle: "Masala Chai",
      recipeSlug: "masala-chai",
      photoPath: `${A}/h-rep.jpg`,
      changes: "changes for h-rep",
      userId: A,
      authorName: "Priya Sharma",
      authorBanned: false,
    });
    expect(byId["p-new"]).toMatchObject({ status: "pending", aiVerdict: "review", aiReason: "Unsure the photo is food", reportCount: 0, reportReasons: [] });
    expect(byId["p-old"]).toMatchObject({ status: "pending", aiVerdict: null, aiReason: null, reportCount: 0 });
    // only reports since the last approval count
    expect(byId["a-reported"]).toMatchObject({ status: "approved", reportCount: 1, reportReasons: ["Spam link"], authorName: "A home cook", userId: B });
  });

  it("leaves out approved remixes with no new reports", () => {
    const q = buildQueue({ remixes: REMIXES, reports: REPORTS, bannedUserIds: [] });
    const ids = q.map((i) => i.id);
    for (const id of ["a-quiet", "a-old-reports", "h-ai", "h-admin", "h-ban"]) expect(ids).not.toContain(id);
  });

  it("flags remixes whose author is banned", () => {
    const q = buildQueue({ remixes: REMIXES, reports: REPORTS, bannedUserIds: [A] });
    expect(q.filter((i) => i.userId === A).every((i) => i.authorBanned)).toBe(true);
    expect(q.find((i) => i.id === "a-reported")!.authorBanned).toBe(false);
  });
});

type Query = { table: string; select: string; or: string[]; eq: [string, unknown][]; in: [string, unknown][]; limit: number[]; other: string[] };

/**
 * A fake admin client that applies the filters the queue uses: .or("col.eq.val,..."),
 * .eq(col, val), and a "remix_reports!inner(" embed (only rows that have reports). It records
 * every query so the tests can check the reads are bounded.
 */
function fakeAdminClient(tablesIn: Record<string, object[]>, failing: string[] = []) {
  const tables = tablesIn as Record<string, Record<string, unknown>[]>;
  const queries: Query[] = [];
  const from = vi.fn((table: string) => {
    const q: Query = { table, select: "", or: [], eq: [], in: [], limit: [], other: [] };
    queries.push(q);
    const rows = () => {
      let r = tables[table] ?? [];
      for (const expr of q.or) {
        const terms = expr.split(",").map((t) => t.trim().split("."));
        r = r.filter((row) => terms.some(([col, op, ...val]) => op === "eq" && String(row[col]) === val.join(".")));
      }
      for (const [col, val] of q.eq) r = r.filter((row) => row[col] === val);
      if (table === "remixes" && /remix_reports!inner\s*\(/.test(q.select)) {
        r = r.filter((row) => Array.isArray(row.remix_reports) && row.remix_reports.length > 0);
      }
      return r;
    };
    const result = () =>
      failing.includes(table) ? { data: null, error: { message: "boom" }, count: null } : { data: rows(), error: null, count: rows().length };
    const b: Record<string, unknown> = {};
    b.select = (cols: string) => {
      q.select = cols;
      return b;
    };
    b.or = (expr: string) => {
      q.or.push(expr);
      return b;
    };
    b.eq = (col: string, val: unknown) => {
      q.eq.push([col, val]);
      return b;
    };
    b.in = (col: string, val: unknown) => {
      q.in.push([col, val]);
      return b;
    };
    b.limit = (n: number) => {
      q.limit.push(n);
      return b;
    };
    for (const m of ["order", "range", "neq", "is", "not", "filter", "match", "gt", "gte", "lt", "lte", "returns"]) {
      b[m] = (...args: unknown[]) => {
        q.other.push(`${m}(${args.map((a) => JSON.stringify(a)).join(",")})`);
        return b;
      };
    }
    b.single = async () => result();
    b.maybeSingle = async () => result();
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    return b;
  });
  const rpc = vi.fn(async () => ({ data: null, error: { message: "no rpc expected" } }));
  return { supabase: { from, rpc, storage: { from: vi.fn() } } as unknown as SupabaseClient, queries, from, rpc };
}

/** The remixes rows as PostgREST returns them, with their reports embedded. */
const EMBEDDED = REMIXES.map((r) => ({ ...r, remix_reports: REPORTS.filter((x) => x.remix_id === r.id) }));

const BANS = [
  { user_id: C, reason: "Spam links", banned_by: A, created_at: "2026-11-10T00:00:00Z" },
  { user_id: B, reason: null, banned_by: A, created_at: "2026-11-12T00:00:00Z" },
];
const PROFILES = [
  { id: A, name: "Priya Sharma", is_admin: false },
  { id: B, name: "Ben", is_admin: false },
  { id: C, name: null, is_admin: false },
];
const RECIPES = [{ id: "11111111-1111-4111-8111-111111111111", title: "Masala Chai", slug: "masala-chai" }];
const TABLES = () => ({ remixes: EMBEDDED, remix_reports: REPORTS, bans: [], profiles: PROFILES, recipes: RECIPES });

describe("queue loaders", () => {
  it("loadModerationQueue reads remixes with their reports embedded, through the admin's client", async () => {
    const f = fakeAdminClient(TABLES());
    const q = await loadModerationQueue(f.supabase);
    expect(q).toEqual({ items: buildQueue({ remixes: REMIXES, reports: REPORTS, bannedUserIds: [] }), failed: false });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("B3: reports are embedded, never read on their own or turned into an id list", async () => {
    const f = fakeAdminClient(TABLES());
    await loadModerationQueue(f.supabase);
    expect(f.queries.map((q) => q.table)).not.toContain("remix_reports");
    const remixQueries = f.queries.filter((q) => q.table === "remixes");
    expect(remixQueries.length).toBeGreaterThanOrEqual(1);
    for (const q of remixQueries) {
      expect(q.select).toMatch(/remix_reports(!inner)?\s*\(/);
      expect(q.in.filter(([col]) => col === "id")).toEqual([]);
      expect(q.or.join(" ")).not.toMatch(/id\.in\./);
      expect(q.other.join(" ")).not.toMatch(/id\.in|"id","in"/);
    }
  });

  it("B3: bounded queries: pending or hidden by reports, plus approved remixes with reports", async () => {
    const f = fakeAdminClient(TABLES());
    await loadModerationQueue(f.supabase);
    const remixQueries = f.queries.filter((q) => q.table === "remixes");
    const waiting = remixQueries.find((q) => q.or.some((o) => /status\.eq\.pending/.test(o) && /hidden_by\.eq\.reports/.test(o)));
    expect(waiting, "a query for pending or hidden_by=reports").toBeDefined();
    const reported = remixQueries.find((q) => q.eq.some(([c, v]) => c === "status" && v === "approved"));
    expect(reported, "a query for approved remixes").toBeDefined();
    expect(reported!.select).toMatch(/remix_reports!inner\s*\(/);
    // no query reads every remix
    for (const q of remixQueries) {
      expect(q.or.length + q.eq.length).toBeGreaterThan(0);
      expect(q.limit.length).toBeGreaterThan(0);
      for (const n of q.limit) expect(n).toBeGreaterThan(0);
      for (const n of q.limit) expect(n).toBeLessThanOrEqual(500);
    }
  });

  it("a read error gives an empty queue", async () => {
    for (const failing of [["remixes"], ["bans"]]) {
      const f = fakeAdminClient(TABLES(), failing);
      await expect(loadModerationQueue(f.supabase)).resolves.toEqual({ items: [], failed: true });
    }
    // a client that throws is a failed load too, never an exception
    const throwing = { from: () => { throw new Error("fetch failed"); }, rpc: vi.fn() } as unknown as SupabaseClient;
    await expect(loadModerationQueue(throwing)).resolves.toEqual({ items: [], failed: true });
  });

  it("loadBannedUsers lists bans newest first with the user's name", async () => {
    const f = fakeAdminClient({ bans: BANS, profiles: PROFILES });
    const banned = await loadBannedUsers(f.supabase);
    expect(f.queries.map((q) => q.table)).toContain("bans");
    expect(banned.map((b) => [b.userId, b.reason])).toEqual([
      [B, null],
      [C, "Spam links"],
    ]);
    expect(banned[0].name).toBe("Ben");
    expect(banned[1].name).toBe("A home cook");
  });

  it("countWaitingRemixes counts what the queue lists", async () => {
    const f = fakeAdminClient(TABLES());
    await expect(countWaitingRemixes(f.supabase)).resolves.toBe(4);
  });

  it("B3: countWaitingRemixes is null on error, never 0", async () => {
    const f = fakeAdminClient(TABLES(), ["remixes"]);
    await expect(countWaitingRemixes(f.supabase)).resolves.toBeNull();
  });
});
