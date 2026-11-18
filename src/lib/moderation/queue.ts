// The admin moderation queue, read with the admin's own session client (RLS: admins read every
// remix, report, ban and profile). Never a service-role client.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ANONYMOUS_AUTHOR } from "@/lib/remix/feed";
import type { AiVerdict, HiddenBy, RemixStatus } from "@/lib/remix/types";

/** A remixes row as the admin reads it, with the embedded recipe and author profile. */
export interface QueueRemixRow {
  id: string;
  user_id: string;
  recipe_id: string;
  photo_path: string;
  changes: string;
  status: RemixStatus;
  ai_verdict: AiVerdict | null;
  ai_reason: string | null;
  ai_checked_at: string | null;
  hidden_by: HiddenBy | null;
  reports_cleared_at: string | null;
  moderated_at: string | null;
  challenge_id: string | null;
  created_at: string;
  recipes: { title: string; slug: string } | null;
  profiles: { name: string | null } | null;
}

/** A remix_reports row. */
export interface QueueReportRow {
  remix_id: string;
  user_id: string;
  reason: string | null;
  created_at: string;
}

export interface QueueItem {
  id: string;
  userId: string;
  authorName: string;
  recipeTitle: string;
  recipeSlug: string;
  photoPath: string;
  changes: string;
  status: RemixStatus;
  hiddenBy: HiddenBy | null;
  aiVerdict: AiVerdict | null;
  aiReason: string | null;
  reportCount: number;
  reportReasons: string[];
  createdAt: string;
  authorBanned: boolean;
}

export interface BannedUser {
  userId: string;
  name: string;
  reason: string | null;
  createdAt: string;
}

/** Reports made since the admin last approved the remix (all of them when never). */
const sinceCleared = (reports: QueueReportRow[], clearedAt: string | null) =>
  clearedAt ? reports.filter((r) => Date.parse(r.created_at) > Date.parse(clearedAt)) : reports;

/**
 * Pending remixes, remixes hidden by reports, and approved remixes with new reports, oldest first.
 * Remixes hidden by the AI, the admin or a ban are left out.
 */
export function buildQueue({
  remixes,
  reports,
  bannedUserIds,
}: {
  remixes: QueueRemixRow[];
  reports: QueueReportRow[];
  bannedUserIds: string[];
}): QueueItem[] {
  const banned = new Set(bannedUserIds);
  const byRemix = new Map<string, QueueReportRow[]>();
  for (const r of reports) byRemix.set(r.remix_id, [...(byRemix.get(r.remix_id) ?? []), r]);

  return remixes
    .map((m) => ({ m, recent: sinceCleared(byRemix.get(m.id) ?? [], m.reports_cleared_at) }))
    .filter(
      ({ m, recent }) =>
        m.status === "pending" ||
        (m.status === "hidden" && m.hidden_by === "reports") ||
        (m.status === "approved" && recent.length > 0),
    )
    .sort((a, b) => Date.parse(a.m.created_at) - Date.parse(b.m.created_at))
    .map(({ m, recent }) => ({
      id: m.id,
      userId: m.user_id,
      authorName: m.profiles?.name?.trim() || ANONYMOUS_AUTHOR,
      recipeTitle: m.recipes?.title ?? "",
      recipeSlug: m.recipes?.slug ?? "",
      photoPath: m.photo_path,
      changes: m.changes,
      status: m.status,
      hiddenBy: m.hidden_by,
      aiVerdict: m.ai_verdict,
      aiReason: m.ai_reason,
      reportCount: recent.length,
      reportReasons: recent.flatMap((r) => (r.reason?.trim() ? [r.reason.trim()] : [])),
      createdAt: m.created_at,
      authorBanned: banned.has(m.user_id),
    }));
}

const REMIX_COLUMNS =
  "id, user_id, recipe_id, photo_path, changes, status, ai_verdict, ai_reason, ai_checked_at, hidden_by, " +
  "reports_cleared_at, moderated_at, challenge_id, created_at, " +
  // remix_reports is also a remixes-profiles join table, so the author's profile is named by its key.
  "recipes!remixes_recipe_id_fkey(title, slug), profiles!remixes_user_id_fkey(name)";
const REPORT_COLUMNS = "remix_id, user_id, reason, created_at";

/** Most remixes read by each queue query, oldest first. */
const QUEUE_LIMIT = 200;

type EmbeddedRow = QueueRemixRow & { remix_reports?: QueueReportRow[] | null };

/** The moderation queue, and whether it failed to load (so the page never says "Nothing to check" then). */
export interface ModerationQueue {
  items: QueueItem[];
  failed: boolean;
}

/**
 * Two bounded reads with the reports embedded: remixes pending or hidden by reports, and approved
 * remixes that have reports (buildQueue keeps those with reports since the last approval).
 */
export async function loadModerationQueue(supabase: SupabaseClient): Promise<ModerationQueue> {
  try {
    const [waiting, reported, bans] = await Promise.all([
      supabase
        .from("remixes")
        .select(`${REMIX_COLUMNS}, remix_reports(${REPORT_COLUMNS})`)
        .or("status.eq.pending,hidden_by.eq.reports")
        .order("created_at", { ascending: true })
        .limit(QUEUE_LIMIT),
      supabase
        .from("remixes")
        .select(`${REMIX_COLUMNS}, remix_reports!inner(${REPORT_COLUMNS})`)
        .eq("status", "approved")
        .order("created_at", { ascending: true })
        .limit(QUEUE_LIMIT),
      supabase.from("bans").select("user_id"),
    ]);
    if (waiting.error || reported.error || bans.error) return { items: [], failed: true };

    const rows = new Map<string, EmbeddedRow>();
    for (const r of [...(waiting.data ?? []), ...(reported.data ?? [])] as unknown as EmbeddedRow[]) rows.set(r.id, r);
    const remixes = [...rows.values()].map(({ remix_reports, ...remix }) => ({ remix, reports: remix_reports ?? [] }));
    return {
      items: buildQueue({
        remixes: remixes.map((r) => r.remix),
        reports: remixes.flatMap((r) => r.reports),
        bannedUserIds: ((bans.data ?? []) as { user_id: string }[]).map((b) => b.user_id),
      }),
      failed: false,
    };
  } catch {
    return { items: [], failed: true };
  }
}

/** Banned users, newest ban first, with their profile name. */
export async function loadBannedUsers(supabase: SupabaseClient): Promise<BannedUser[]> {
  try {
    const bans = await supabase.from("bans").select("user_id, reason, created_at").order("created_at", { ascending: false });
    if (bans.error) return [];
    const rows = (bans.data ?? []) as { user_id: string; reason: string | null; created_at: string }[];
    if (rows.length === 0) return [];
    // bans has two foreign keys to profiles (user_id, banned_by), so names are matched by id.
    const profiles = await supabase
      .from("profiles")
      .select("id, name")
      .in(
        "id",
        rows.map((b) => b.user_id),
      );
    const names = new Map(((profiles.data ?? []) as { id: string; name: string | null }[]).map((p) => [p.id, p.name]));
    return rows
      .map((b) => ({
        userId: b.user_id,
        name: names.get(b.user_id)?.trim() || ANONYMOUS_AUTHOR,
        reason: b.reason,
        createdAt: b.created_at,
      }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

/** How many remixes the queue lists (the count on /admin), or null when it could not be loaded. */
export async function countWaitingRemixes(supabase: SupabaseClient): Promise<number | null> {
  const queue = await loadModerationQueue(supabase);
  return queue.failed ? null : queue.items.length;
}
