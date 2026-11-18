// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, banUser, createDb, createUser, expectBlockedWrite, insertRecipe, makeAdmin,
  pgErrorOf, seedRemix, visibleRows, type RemixStatus,
} from "./helpers/db";

/*
 * Task 3 slice D contract (supabase/migrations/20261119000007_remix_reports.sql):
 *   remixes gains moderation columns, none writable by users:
 *     ai_verdict text (approve | review | reject), ai_reason text (<= 300), ai_checked_at timestamptz,
 *     hidden_by text (ai | reports | admin | ban), reports_cleared_at timestamptz, moderated_at timestamptz.
 *   remix_reports (remix_id -> remixes on delete cascade, user_id default auth.uid() -> profiles,
 *     reason text <= 300 (null allowed), created_at default now(), primary key (remix_id, user_id)).
 *   RLS on. insert: own row (user_id = auth.uid()) on a public remix (remix_is_public) that is not
 *     the reporter's own; restrictive insert: not is_banned(). select: own rows or admin.
 *     No update or delete for anyone through the API. created_at is never chosen by the client.
 *   after insert trigger (security definer): locks the remix; when 3 distinct users who are not
 *     banned have reported it since reports_cleared_at (all reports when null), sets
 *     status = 'hidden', hidden_by = 'reports' (slice D review NIT4: banned reporters don't count).
 *   The "after the admin approves" case uses admin_moderate_remix from 20261119000008, which sets
 *     reports_cleared_at = now() on approve.
 *
 * Note: docs/plans/task-3.md says the report reason is up to 300 characters (slice D); that is the
 * limit tested here.
 */

let db: PGlite;
let alice: string; // remix author
let bob: string;
let carol: string;
let dave: string;
let erin: string;
let banned: string;
let admin: string;
let recipe: { id: string; slug: string };

const remix = (owner: string, status: RemixStatus = "approved") =>
  seedRemix(db, { recipe_id: recipe.id, user_id: owner, status }).then((r) => r.id);

const report = (uid: string, remixId: string, reason: string | null = null) =>
  asUser(db, uid, async (tx) =>
    (await tx.query<{ remix_id: string; user_id: string; reason: string | null }>(
      `insert into remix_reports (remix_id, reason) values ($1, $2) returning remix_id, user_id, reason`,
      [remixId, reason],
    )).rows[0],
  );

async function remixRow(id: string) {
  const [row] = await asSuper<{ status: string; hidden_by: string | null; reports_cleared_at: Date | null }>(
    db, `select status, hidden_by, reports_cleared_at from remixes where id = $1`, [id],
  );
  return row;
}

async function reportsOn(id: string) {
  return (await asSuper<{ user_id: string }>(db, `select user_id from remix_reports where remix_id = $1 order by user_id`, [id]))
    .map((r) => r.user_id);
}

async function inFeed(id: string) {
  const rows = await asAnon(db, async (tx) =>
    (await tx.query<{ id: string }>(`select id from public.remix_feed(p_recipe_id => $1, p_limit => 48)`, [recipe.id])).rows,
  );
  return rows.some((r) => r.id === id);
}

beforeAll(async () => {
  db = await createDb();
  [alice, bob, carol, dave, erin, banned, admin] = await Promise.all(
    Array.from({ length: 7 }, (_, i) => createUser(db, { meta: { name: `User${i}` } })),
  );
  await makeAdmin(db, admin);
  await banUser(db, banned, { by: admin });
  recipe = await insertRecipe(db, { status: "live" });
});

describe("remix_reports RLS (task 3 slice D)", () => {
  it("adds the moderation columns to remixes and enables RLS on remix_reports", async () => {
    const cols = await asSuper<{ column_name: string }>(
      db,
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'remixes'`,
    );
    for (const c of ["ai_verdict", "ai_reason", "ai_checked_at", "hidden_by", "reports_cleared_at", "moderated_at"]) {
      expect(cols.map((r) => r.column_name)).toContain(c);
    }
    const [t] = await asSuper<{ rls: boolean }>(
      db, `select relrowsecurity as rls from pg_class where oid = 'public.remix_reports'::regclass`,
    );
    expect(t.rls).toBe(true);
    // the check constraints hold for the new columns
    const id = await remix(alice);
    await expect(db.query(`update remixes set ai_verdict = 'maybe' where id = $1`, [id])).rejects.toThrow();
    await expect(db.query(`update remixes set hidden_by = 'someone' where id = $1`, [id])).rejects.toThrow();
    await expect(db.query(`update remixes set ai_reason = repeat('x', 301) where id = $1`, [id])).rejects.toThrow();
  });

  it("a signed-in user reports an approved remix once, with an optional reason up to 300 characters", async () => {
    const id = await remix(alice);
    expect(await report(bob, id)).toEqual({ remix_id: id, user_id: bob, reason: null });
    expect(await report(carol, id, "Has a link to a spam site")).toEqual({ remix_id: id, user_id: carol, reason: "Has a link to a spam site" });
    const max = "r".repeat(300);
    expect((await report(dave, id, max)).reason).toBe(max);
    expect(await reportsOn(id)).toEqual([bob, carol, dave].sort());

    const other = await remix(alice);
    const err = await pgErrorOf(() => report(bob, other, "r".repeat(301)));
    expect(err.code).toBe("23514");
    expect(await reportsOn(other)).toEqual([]);
  });

  it("a second report by the same user is a duplicate", async () => {
    const id = await remix(alice);
    await report(bob, id);
    const err = await pgErrorOf(() => report(bob, id, "again"));
    expect(err.code).toBe("23505");
    expect(await reportsOn(id)).toEqual([bob]);
  });

  it("a reporter cannot report as someone else or backdate a report", async () => {
    const id = await remix(alice);
    await expect(
      asUser(db, bob, (tx) => tx.query(`insert into remix_reports (remix_id, user_id) values ($1, $2)`, [id, carol])),
    ).rejects.toThrow();
    expect(await reportsOn(id)).toEqual([]);

    // created_at is set by the database (refused, or overwritten with now())
    try {
      await asUser(db, bob, (tx) =>
        tx.query(`insert into remix_reports (remix_id, created_at) values ($1, '2000-01-01T00:00:00Z')`, [id]),
      );
    } catch {
      // refused outright is fine
    }
    const rows = await asSuper<{ created_at: Date }>(db, `select created_at from remix_reports where remix_id = $1`, [id]);
    for (const r of rows) expect(r.created_at.getTime()).toBeGreaterThan(Date.now() - 60 * 60 * 1000);
  });

  it("pending, hidden and own remixes cannot be reported", async () => {
    const pending = await remix(alice, "pending");
    const hidden = await remix(alice, "hidden");
    const own = await remix(bob, "approved");
    for (const id of [pending, hidden, own]) {
      const err = await pgErrorOf(() => report(bob, id));
      expect(err.code).toBe("42501");
      expect(await reportsOn(id)).toEqual([]);
    }
    // a remix of a recipe that is no longer live, or by a banned author, is not public either
    const draft = await insertRecipe(db, { status: "draft" });
    const ofDraft = (await seedRemix(db, { recipe_id: draft.id, user_id: alice, status: "approved" })).id;
    const byBanned = await remix(banned, "approved");
    for (const id of [ofDraft, byBanned]) {
      expect((await pgErrorOf(() => report(carol, id))).code).toBe("42501");
      expect(await reportsOn(id)).toEqual([]);
    }
    // an unknown remix id is refused too
    await expect(report(carol, "00000000-0000-4000-8000-000000000000")).rejects.toThrow();
  });

  it("anon and banned users cannot report", async () => {
    const id = await remix(alice);
    await expect(
      asAnon(db, (tx) => tx.query(`insert into remix_reports (remix_id, user_id) values ($1, $2)`, [id, bob])),
    ).rejects.toThrow();
    const err = await pgErrorOf(() => report(banned, id, "spite"));
    expect(err.code).toBe("42501");
    expect(await reportsOn(id)).toEqual([]);
  });

  it("reporter reads own report, other users cannot, admin reads all", async () => {
    const id = await remix(alice);
    await report(bob, id, "rude");
    await report(carol, id);
    const bobSees = await asUser(db, bob, async (tx) =>
      (await tx.query<{ user_id: string; reason: string | null }>(`select user_id, reason from remix_reports where remix_id = $1`, [id])).rows,
    );
    expect(bobSees).toEqual([{ user_id: bob, reason: "rude" }]);
    // the remix author does not learn who reported them
    const aliceSees = await asUser(db, alice, async (tx) =>
      (await tx.query(`select * from remix_reports where remix_id = $1`, [id])).rows,
    );
    expect(aliceSees).toEqual([]);
    const anonSees = await visibleRows(() => asAnon(db, (tx) => tx.query(`select * from remix_reports`)));
    expect(anonSees).toEqual([]);
    const adminSees = await asAdmin(db, admin, async (tx) =>
      (await tx.query<{ user_id: string }>(`select user_id from remix_reports where remix_id = $1 order by user_id`, [id])).rows,
    );
    expect(adminSees.map((r) => r.user_id)).toEqual([bob, carol].sort());
  });

  it("users cannot update or delete reports", async () => {
    const id = await remix(alice);
    await report(bob, id, "rude");
    for (const who of [bob, carol, alice, admin]) {
      await expectBlockedWrite(() => asUser(db, who, (tx) => tx.query(`update remix_reports set reason = 'fine' where remix_id = $1`, [id])));
      await expectBlockedWrite(() => asUser(db, who, (tx) => tx.query(`delete from remix_reports where remix_id = $1`, [id])));
    }
    await expectBlockedWrite(() => asAnon(db, (tx) => tx.query(`delete from remix_reports`)));
    expect(await asSuper(db, `select user_id, reason from remix_reports where remix_id = $1`, [id])).toEqual([
      { user_id: bob, reason: "rude" },
    ]);
  });

  it("users cannot write the moderation columns of a remix", async () => {
    const own = await remix(alice, "hidden");
    for (const sql of [
      `update remixes set status = 'approved', hidden_by = null where id = $1`,
      `update remixes set reports_cleared_at = now() where id = $1`,
      `update remixes set ai_verdict = 'approve' where id = $1`,
    ]) {
      await expectBlockedWrite(() => asUser(db, alice, (tx) => tx.query(sql, [own])));
      await expectBlockedWrite(() => asAdmin(db, admin, (tx) => tx.query(sql, [own])));
    }
    expect(await remixRow(own)).toMatchObject({ status: "hidden" });
    // nor send them on insert
    const photo = `${alice}/0f8fad5b-d9cb-469f-a165-70867728950e.jpg`;
    await db.query(`insert into storage.objects (bucket_id, name, owner) values ('remix-photos', $1, $2)`, [photo, alice]);
    for (const col of ["ai_verdict", "hidden_by"]) {
      const value = col === "ai_verdict" ? "approve" : "admin";
      const err = await pgErrorOf(() =>
        asUser(db, alice, (tx) =>
          tx.query(`insert into remixes (recipe_id, photo_path, changes, ${col}) values ($1, $2, 'x', $3)`, [recipe.id, photo, value]),
        ),
      );
      expect(err.code).toBe("42501");
    }
  });

  it("two reports do not hide the remix", async () => {
    const id = await remix(alice);
    await report(bob, id);
    await report(carol, id);
    expect(await remixRow(id)).toMatchObject({ status: "approved", hidden_by: null });
    expect(await inFeed(id)).toBe(true);
  });

  it("three reports from different users hide the remix with hidden_by reports", async () => {
    const id = await remix(alice);
    await report(bob, id);
    await report(carol, id, "not food");
    await report(dave, id);
    expect(await remixRow(id)).toMatchObject({ status: "hidden", hidden_by: "reports" });
    expect(await inFeed(id)).toBe(false);
    // once hidden it cannot be reported any more
    expect((await pgErrorOf(() => report(erin, id))).code).toBe("42501");
    // other remixes are untouched
    const other = await remix(alice);
    expect(await remixRow(other)).toMatchObject({ status: "approved" });
  });

  it("after the admin approves, only new reports count toward the next three", async () => {
    const id = await remix(alice);
    await report(bob, id);
    await report(carol, id);
    await report(dave, id);
    expect((await remixRow(id)).status).toBe("hidden");

    await asAdmin(db, admin, (tx) =>
      tx.query(`select public.admin_moderate_remix(p_remix_id => $1, p_action => 'approve')`, [id]),
    );
    const afterApprove = await remixRow(id);
    expect(afterApprove).toMatchObject({ status: "approved", hidden_by: null });
    expect(afterApprove.reports_cleared_at).not.toBeNull();
    // the old reports are kept for the record
    expect(await reportsOn(id)).toHaveLength(3);

    const frank = await createUser(db);
    const grace = await createUser(db);
    await report(erin, id);
    await report(frank, id);
    expect((await remixRow(id)).status).toBe("approved"); // 2 new + 3 old is not "three new"
    await report(grace, id);
    expect(await remixRow(id)).toMatchObject({ status: "hidden", hidden_by: "reports" });
  });

  it("NIT4: a banned user's earlier reports do not count toward the three", async () => {
    const id = await remix(alice);
    const troll = await createUser(db);
    await report(troll, id, "made up");
    // the reporter is banned afterwards (through the admin function, as in the app)
    await asAdmin(db, admin, (tx) => tx.query(`select public.admin_ban_user(p_user_id => $1, p_reason => 'abuse')`, [troll]));
    await report(bob, id);
    await report(carol, id);
    expect(await remixRow(id)).toMatchObject({ status: "approved", hidden_by: null }); // 2 real reporters
    expect(await inFeed(id)).toBe(true);
    // a third reporter who is not banned does hide it
    await report(dave, id);
    expect(await remixRow(id)).toMatchObject({ status: "hidden", hidden_by: "reports" });
  });

  it("deleting a remix deletes its reports", async () => {
    const id = await remix(alice);
    await report(bob, id);
    await asUser(db, alice, (tx) => tx.query(`delete from remixes where id = $1`, [id]));
    expect(await reportsOn(id)).toEqual([]);
  });
});
