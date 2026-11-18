// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, banUser, createDb, createUser, insertRecipe, makeAdmin, pgErrorOf, seedRemix,
  uploadObject, uuid, type RemixStatus, type Tx,
} from "./helpers/db";

/*
 * Task 3 slice D contract (supabase/migrations/20261119000008_moderation_functions.sql).
 * All security definer, search_path = '', execute revoked from public and anon.
 *
 *   apply_ai_verdict(p_remix_id uuid, p_verdict text, p_reason text) returns text
 *     execute to service_role ONLY (not authenticated, admins included).
 *     Acts once, only on a remix that is 'pending' with ai_checked_at null: sets ai_verdict,
 *     ai_reason (cut to 300 characters), ai_checked_at = now(), and
 *       approve -> status 'approved'; review -> stays 'pending'; reject -> 'hidden', hidden_by 'ai'.
 *     Never approves a banned user's remix. Returns the remix's status after the call, or null when
 *     it did nothing (already checked, not pending, unknown id). A verdict that is not
 *     approve | review | reject raises 22023.
 *
 *   admin_moderate_remix(p_remix_id uuid, p_action text) -- 'approve' | 'hide'
 *     execute to authenticated; raises 42501 unless is_admin() (anon has no execute at all).
 *     Any other action raises 22023; an id with no remix raises P0002 (NIT9).
 *     Approving a banned author's remix raises SMM02.
 *     approve: status 'approved', hidden_by null, reports_cleared_at = now(), moderated_at = now().
 *       Refused (raises) when the author is banned.
 *     hide: status 'hidden', hidden_by 'admin', moderated_at = now().
 *
 *   admin_ban_user(p_user_id uuid, p_reason text default null)
 *     admin only (42501 otherwise). Records bans (user_id, reason, banned_by = the admin), hides all
 *     their remixes that are not already hidden (hidden_by 'ban'), deletes their likes. Refuses the
 *     caller themselves and any other admin (SQLSTATE SMM01). Reason <= 500 (bans check).
 *
 *   admin_unban_user(p_user_id uuid)
 *     admin only (42501 otherwise). Deletes the ban; their remixes stay hidden.
 */

let db: PGlite;
let alice: string;
let bob: string;
let carol: string;
let admin: string;
let admin2: string;
let recipe: { id: string; slug: string };

/** Runs fn as the Supabase service role (the server's service-role client). */
const asService = <T>(fn: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.query(`set local role service_role`);
    await tx.query(`select set_config('request.jwt.claim.sub', '', true)`);
    return fn(tx);
  });

const verdict = (tx: Tx, remixId: string, v: string, reason = "Looks tasty") =>
  tx.query<{ status: string | null }>(
    `select public.apply_ai_verdict(p_remix_id => $1, p_verdict => $2, p_reason => $3) as status`,
    [remixId, v, reason],
  );
const applyVerdict = async (remixId: string, v: string, reason?: string) =>
  (await asService((tx) => verdict(tx, remixId, v, reason))).rows[0].status;

const moderate = (who: string, remixId: string, action: string) =>
  asUser(db, who, (tx) => tx.query(`select public.admin_moderate_remix(p_remix_id => $1, p_action => $2)`, [remixId, action]));
const ban = (who: string, target: string, reason: string | null = "spam") =>
  asUser(db, who, (tx) => tx.query(`select public.admin_ban_user(p_user_id => $1, p_reason => $2)`, [target, reason]));
const unban = (who: string, target: string) =>
  asUser(db, who, (tx) => tx.query(`select public.admin_unban_user(p_user_id => $1)`, [target]));

const remix = (owner: string, status: RemixStatus = "pending") =>
  seedRemix(db, { recipe_id: recipe.id, user_id: owner, status }).then((r) => r.id);

type ModRow = {
  status: string;
  ai_verdict: string | null;
  ai_reason: string | null;
  ai_checked_at: Date | null;
  hidden_by: string | null;
  moderated_at: Date | null;
  reports_cleared_at: Date | null;
};
async function row(id: string): Promise<ModRow> {
  const [r] = await asSuper<ModRow>(
    db,
    `select status, ai_verdict, ai_reason, ai_checked_at, hidden_by, moderated_at, reports_cleared_at from remixes where id = $1`,
    [id],
  );
  return r;
}

async function feedIds(): Promise<string[]> {
  const rows = await asAnon(db, async (tx) =>
    (await tx.query<{ id: string }>(`select id from public.remix_feed(p_recipe_id => $1, p_limit => 48)`, [recipe.id])).rows,
  );
  return rows.map((r) => r.id);
}

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db, { meta: { name: "Alice Cook" } });
  bob = await createUser(db, { meta: { name: "Bob" } });
  carol = await createUser(db, { meta: { name: "Carol" } });
  admin = await createUser(db, { meta: { name: "Shef" } });
  admin2 = await createUser(db, { meta: { name: "Helper" } });
  await makeAdmin(db, admin);
  await makeAdmin(db, admin2);
  recipe = await insertRecipe(db, { status: "live" });
});

describe("apply_ai_verdict", () => {
  it("apply_ai_verdict approve, review and reject set approved, pending and hidden with the reason", async () => {
    const a = await remix(alice);
    const r = await remix(alice);
    const j = await remix(alice);
    expect(await applyVerdict(a, "approve", "A lovely plate of chai and biscuits")).toBe("approved");
    expect(await applyVerdict(r, "review", "Hard to tell if this is food")).toBe("pending");
    expect(await applyVerdict(j, "reject", "The photo doesn't show food")).toBe("hidden");

    expect(await row(a)).toMatchObject({ status: "approved", ai_verdict: "approve", ai_reason: "A lovely plate of chai and biscuits", hidden_by: null });
    expect(await row(r)).toMatchObject({ status: "pending", ai_verdict: "review", ai_reason: "Hard to tell if this is food", hidden_by: null });
    expect(await row(j)).toMatchObject({ status: "hidden", ai_verdict: "reject", ai_reason: "The photo doesn't show food", hidden_by: "ai" });
    for (const id of [a, r, j]) expect((await row(id)).ai_checked_at).not.toBeNull();

    const feed = await feedIds();
    expect(feed).toContain(a);
    expect(feed).not.toContain(r);
    expect(feed).not.toContain(j);
  });

  it("apply_ai_verdict acts only once and only on a pending unchecked remix", async () => {
    // reviewed once: a second call (even approve) does nothing
    const r = await remix(alice);
    await applyVerdict(r, "review", "unsure");
    expect(await applyVerdict(r, "approve", "now sure")).toBeNull();
    expect(await row(r)).toMatchObject({ status: "pending", ai_verdict: "review", ai_reason: "unsure" });

    // rejected once: cannot be re-approved by the AI path
    const j = await remix(alice);
    await applyVerdict(j, "reject", "not food");
    expect(await applyVerdict(j, "approve", "food")).toBeNull();
    expect(await row(j)).toMatchObject({ status: "hidden", hidden_by: "ai" });

    // already approved or hidden by the admin: untouched
    const approved = await remix(alice, "approved");
    const hidden = await remix(alice, "hidden");
    expect(await applyVerdict(approved, "reject", "x")).toBeNull();
    expect(await applyVerdict(hidden, "approve", "x")).toBeNull();
    expect(await row(approved)).toMatchObject({ status: "approved", ai_verdict: null, ai_checked_at: null });
    expect(await row(hidden)).toMatchObject({ status: "hidden", ai_verdict: null, ai_checked_at: null });

    // unknown id: nothing, no error
    expect(await applyVerdict(uuid(), "approve")).toBeNull();
  });

  it("apply_ai_verdict refuses an unknown verdict and keeps the reason to 300 characters", async () => {
    const id = await remix(alice);
    const err = await pgErrorOf(() => applyVerdict(id, "maybe"));
    expect(err.code).toBe("22023");
    expect(await row(id)).toMatchObject({ status: "pending", ai_verdict: null, ai_checked_at: null });

    await applyVerdict(id, "review", "z".repeat(400));
    expect((await row(id)).ai_reason!.length).toBeLessThanOrEqual(300);
  });

  it("apply_ai_verdict never approves a banned user's remix", async () => {
    const u = await createUser(db);
    const id = await remix(u);
    await banUser(db, u, { by: admin });
    await applyVerdict(id, "approve", "Looks fine");
    expect((await row(id)).status).not.toBe("approved");
    expect(await feedIds()).not.toContain(id);
  });

  it("anon, users and admins cannot execute apply_ai_verdict, service_role can", async () => {
    const id = await remix(alice);
    for (const run of [
      () => asAnon(db, (tx) => verdict(tx, id, "approve")),
      () => asUser(db, alice, (tx) => verdict(tx, id, "approve")), // the author approving themselves
      () => asUser(db, bob, (tx) => verdict(tx, id, "reject")),
      () => asAdmin(db, admin, (tx) => verdict(tx, id, "approve")),
    ]) {
      const err = await pgErrorOf(run);
      expect(err.code).toBe("42501");
    }
    expect(await row(id)).toMatchObject({ status: "pending", ai_checked_at: null });
    const [priv] = await asSuper<{ anon: boolean; authed: boolean; service: boolean }>(
      db,
      `select has_function_privilege('anon', 'public.apply_ai_verdict(uuid, text, text)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.apply_ai_verdict(uuid, text, text)', 'execute') as authed,
              has_function_privilege('service_role', 'public.apply_ai_verdict(uuid, text, text)', 'execute') as service`,
    );
    expect(priv).toEqual({ anon: false, authed: false, service: true });
    expect(await applyVerdict(id, "approve")).toBe("approved");
  });
});

describe("admin_moderate_remix", () => {
  it("admin_moderate_remix approves and hides for the admin and raises 42501 for anon, users and banned users", async () => {
    const id = await remix(alice);
    const banned = await createUser(db);
    await banUser(db, banned, { by: admin });

    for (const who of [alice, bob, banned]) {
      const err = await pgErrorOf(() => moderate(who, id, "approve"));
      expect(err.code).toBe("42501");
    }
    const anonErr = await pgErrorOf(() =>
      asAnon(db, (tx) => tx.query(`select public.admin_moderate_remix(p_remix_id => $1, p_action => 'approve')`, [id])),
    );
    expect(anonErr.code).toBe("42501");
    expect((await row(id)).status).toBe("pending");

    await moderate(admin, id, "approve");
    let r = await row(id);
    expect(r).toMatchObject({ status: "approved", hidden_by: null });
    expect(r.moderated_at).not.toBeNull();
    expect(r.reports_cleared_at).not.toBeNull();
    expect(await feedIds()).toContain(id);

    // non-admins cannot hide it either
    const err = await pgErrorOf(() => moderate(bob, id, "hide"));
    expect(err.code).toBe("42501");
    expect((await row(id)).status).toBe("approved");

    await moderate(admin, id, "hide");
    r = await row(id);
    expect(r).toMatchObject({ status: "hidden", hidden_by: "admin" });
    expect(await feedIds()).not.toContain(id);

    // an admin can bring back an AI-rejected or report-hidden remix
    const rejected = await remix(alice);
    await applyVerdict(rejected, "reject", "unclear");
    await moderate(admin, rejected, "approve");
    expect(await row(rejected)).toMatchObject({ status: "approved", hidden_by: null });
  });

  it("admin_moderate_remix refuses an unknown action", async () => {
    const id = await remix(alice);
    for (const action of ["delete", "pending", ""]) {
      const err = await pgErrorOf(() => moderate(admin, id, action));
      expect(err.code).toBe("22023");
    }
    expect((await row(id)).status).toBe("pending");
  });

  it("NIT9: admin_moderate_remix on a missing id raises P0002", async () => {
    for (const action of ["approve", "hide"]) {
      const err = await pgErrorOf(() => moderate(admin, uuid(), action));
      expect(err.code).toBe("P0002");
    }
    // a non-admin still gets 42501 first, so they cannot probe which ids exist
    const err = await pgErrorOf(() => moderate(bob, uuid(), "approve"));
    expect(err.code).toBe("42501");
  });

  it("approving a banned user's remix is refused", async () => {
    const u = await createUser(db);
    const id = await remix(u);
    await banUser(db, u, { by: admin });
    const err = await pgErrorOf(() => moderate(admin, id, "approve"));
    expect(err.code).toBe("SMM02");
    expect((await row(id)).status).not.toBe("approved");
    // hiding it is still allowed
    await moderate(admin, id, "hide");
    expect((await row(id)).status).toBe("hidden");
  });
});

describe("bans", () => {
  it("admin_ban_user records the ban, hides their remixes and removes their likes, then the user cannot post, like, report or upload", async () => {
    const u = await createUser(db, { meta: { name: "Spammer" } });
    const approved = await remix(u, "approved");
    const pending = await remix(u, "pending");
    const leftover = await uploadObject(db, u); // a photo uploaded before the ban
    const target = await remix(bob, "approved");
    await asUser(db, u, (tx) => tx.query(`insert into likes (remix_id) values ($1)`, [target]));
    await asUser(db, carol, (tx) => tx.query(`insert into likes (remix_id) values ($1)`, [target]));

    await ban(admin, u, "Posting links to a shop");

    expect(await asSuper(db, `select user_id, reason, banned_by from bans where user_id = $1`, [u])).toEqual([
      { user_id: u, reason: "Posting links to a shop", banned_by: admin },
    ]);
    for (const id of [approved, pending]) expect(await row(id)).toMatchObject({ status: "hidden", hidden_by: "ban" });
    expect(await feedIds()).not.toContain(approved);
    // their likes are gone, other people's stay
    const likes = await asSuper<{ user_id: string }>(db, `select user_id from likes where remix_id = $1`, [target]);
    expect(likes.map((l) => l.user_id)).toEqual([carol]);

    // cannot post (even with a photo uploaded before the ban), like, report or upload
    const postErr = await pgErrorOf(() =>
      asUser(db, u, (tx) => tx.query(`insert into remixes (recipe_id, photo_path, changes) values ($1, $2, 'again')`, [recipe.id, leftover])),
    );
    expect(postErr.code).toBe("42501");
    await expect(asUser(db, u, (tx) => tx.query(`insert into likes (remix_id) values ($1)`, [target]))).rejects.toThrow();
    await expect(asUser(db, u, (tx) => tx.query(`insert into remix_reports (remix_id) values ($1)`, [target]))).rejects.toThrow();
    await expect(uploadObject(db, u)).rejects.toThrow();
  });

  it("non-admins cannot ban or unban", async () => {
    const u = await createUser(db);
    for (const who of [alice, bob]) {
      const err = await pgErrorOf(() => ban(who, u));
      expect(err.code).toBe("42501");
    }
    const anonErr = await pgErrorOf(() =>
      asAnon(db, (tx) => tx.query(`select public.admin_ban_user(p_user_id => $1, p_reason => 'x')`, [u])),
    );
    expect(anonErr.code).toBe("42501");
    expect(await asSuper(db, `select 1 from bans where user_id = $1`, [u])).toHaveLength(0);

    await banUser(db, u, { by: admin });
    for (const who of [u, alice]) {
      const err = await pgErrorOf(() => unban(who, u));
      expect(err.code).toBe("42501");
    }
    expect(await asSuper(db, `select 1 from bans where user_id = $1`, [u])).toHaveLength(1);
  });

  it("admin cannot ban themselves or another admin", async () => {
    for (const target of [admin, admin2]) {
      const err = await pgErrorOf(() => ban(admin, target));
      expect(err.code).toBe("SMM01");
    }
    expect(await asSuper(db, `select user_id from bans where user_id in ($1, $2)`, [admin, admin2])).toHaveLength(0);
  });

  it("a ban reason over 500 characters is refused", async () => {
    const u = await createUser(db);
    const err = await pgErrorOf(() => ban(admin, u, "x".repeat(501)));
    expect(err.code).toBe("23514");
    expect(await asSuper(db, `select 1 from bans where user_id = $1`, [u])).toHaveLength(0);
    // 500 is fine
    await ban(admin, u, "x".repeat(500));
    expect(await asSuper(db, `select 1 from bans where user_id = $1`, [u])).toHaveLength(1);
  });

  it("admin_unban_user lifts the ban and their remixes stay hidden", async () => {
    const u = await createUser(db);
    const id = await remix(u, "approved");
    await ban(admin, u);
    expect((await row(id)).status).toBe("hidden");

    await unban(admin, u);
    expect(await asSuper(db, `select 1 from bans where user_id = $1`, [u])).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: "hidden", hidden_by: "ban" });
    expect(await feedIds()).not.toContain(id);
    // they can post again, and it starts pending
    const photo = await uploadObject(db, u);
    const [posted] = (await asUser(db, u, (tx) =>
      tx.query<{ status: string }>(`insert into remixes (recipe_id, photo_path, changes) values ($1, $2, 'back') returning status`, [recipe.id, photo]),
    )).rows;
    expect(posted.status).toBe("pending");
    // and the admin can approve their old remix on purpose
    await moderate(admin, id, "approve");
    expect((await row(id)).status).toBe("approved");
  });
});

describe("moderation data stays private", () => {
  it("users never see another user's AI reason", async () => {
    const id = await remix(alice);
    await applyVerdict(id, "reject", "Contains a phone number");
    // the owner sees their own reason (shown kindly in the app)
    const own = await asUser(db, alice, async (tx) =>
      (await tx.query<{ ai_reason: string | null }>(`select ai_reason from remixes where id = $1`, [id])).rows,
    );
    expect(own).toEqual([{ ai_reason: "Contains a phone number" }]);
    // nobody else does
    const bobSees = await asUser(db, bob, async (tx) => (await tx.query(`select ai_reason from remixes where id = $1`, [id])).rows);
    expect(bobSees).toEqual([]);
    // and the public feed never returns moderation columns
    const approved = await remix(alice);
    await applyVerdict(approved, "approve", "secret note");
    const feed = await asAnon(db, async (tx) =>
      (await tx.query<Record<string, unknown>>(`select * from public.remix_feed(p_recipe_id => $1, p_limit => 48)`, [recipe.id])).rows,
    );
    const mine = feed.find((r) => r.id === approved)!;
    expect(mine).toBeDefined();
    for (const col of ["ai_verdict", "ai_reason", "ai_checked_at", "hidden_by", "reports_cleared_at", "moderated_at", "user_id"]) {
      expect(mine).not.toHaveProperty(col);
    }
    expect(JSON.stringify(feed)).not.toContain("secret note");
  });
});

describe("security definer hygiene", () => {
  it("every task 3 security definer function pins search_path and revokes public execute", async () => {
    const FNS = ["apply_ai_verdict", "admin_moderate_remix", "admin_ban_user", "admin_unban_user"];
    const rows = await asSuper<{
      name: string; definer: boolean; config: string[] | null; pub: boolean; anon: boolean; authed: boolean; service: boolean;
    }>(
      db,
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed,
              has_function_privilege('service_role', p.oid, 'execute') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1)`,
      [FNS],
    );
    expect(rows.map((r) => r.name).sort()).toEqual([...FNS].sort()); // one of each, no overloads
    for (const r of rows) {
      expect({ fn: r.name, definer: r.definer, pub: r.pub, anon: r.anon }).toEqual({ fn: r.name, definer: true, pub: false, anon: false });
      expect({ fn: r.name, search_path: (r.config ?? []).filter((c) => c.startsWith("search_path=")) })
        .toEqual({ fn: r.name, search_path: [expect.stringMatching(/^search_path=(""|)$/)] });
    }
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.apply_ai_verdict).toMatchObject({ authed: false, service: true });
    for (const f of ["admin_moderate_remix", "admin_ban_user", "admin_unban_user"]) expect(by[f]).toMatchObject({ authed: true });

    // the report trigger function is security definer, pinned, and not callable from the API
    const trig = await asSuper<{ definer: boolean; config: string[] | null; anon: boolean; authed: boolean }>(
      db,
      `select p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed
       from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.remix_reports'::regclass and not t.tgisinternal`,
    );
    expect(trig.length).toBeGreaterThanOrEqual(1);
    for (const t of trig) {
      expect(t).toMatchObject({ definer: true, anon: false, authed: false });
      expect((t.config ?? []).filter((c) => c.startsWith("search_path="))).toEqual([expect.stringMatching(/^search_path=(""|)$/)]);
    }
  });

  it("remix_reports is in the RLS sweep and the new migrations apply after slice C", async () => {
    const fresh = await createDb({ until: "20261119000007" });
    expect((await fresh.query(`select to_regclass('public.remix_reports') as t`)).rows).toEqual([{ t: null }]);
    await fresh.close();
    const [t] = await asSuper<{ rls: boolean }>(
      db, `select relrowsecurity as rls from pg_class where oid = 'public.remix_reports'::regclass`,
    );
    expect(t.rls).toBe(true);
  });
});
