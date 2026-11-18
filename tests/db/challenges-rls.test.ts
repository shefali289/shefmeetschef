// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, banUser, createDb, createUser, expectBlockedWrite, insertRecipe, makeAdmin,
  pgErrorOf, seedRemix, uploadObject, uuid, visibleRows, type RemixStatus,
} from "./helpers/db";

/*
 * Task 3 slice C contract (supabase/migrations/20261119000006_challenges_rules.sql):
 *   public.nz_today() returns date: today's date in Pacific/Auckland, whatever the session time
 *   zone. Executable by anon and authenticated (the security invoker remix trigger calls it).
 *
 *   challenges.description <= 2000 characters (check, not valid). Existing policies stay: anyone
 *   reads; only admins insert, update, delete.
 *
 *   challenges_validate trigger (before insert or update, security definer, search_path = '',
 *   advisory lock), for every role including the database owner:
 *   - base_recipe_id must be a live Shef recipe on insert and whenever it changes
 *     -> SQLSTATE SMC01 (message mentions "base recipe"). A null base_recipe_id set by
 *     "on delete set null" is allowed on update.
 *   - dates may not overlap any other challenge (inclusive ranges; back-to-back is fine)
 *     -> SQLSTATE 23P01 (exclusion_violation).
 *   - winner_remix_id may be set (non-null, changed) only when nz_today() > ends_on
 *     -> SQLSTATE SMC02; and only to an approved remix whose challenge_id is this challenge
 *     -> SQLSTATE SMC03. Clearing it (null) is always allowed (e.g. the winning remix is deleted).
 *   - ends_on < starts_on is still the existing challenges_dates check (23514).
 *
 *   The remix insert trigger (create or replace remixes_before_insert, or a later-sorting trigger)
 *   sets remixes.challenge_id to the challenge whose base_recipe_id = recipe_id and
 *   starts_on <= nz_today() <= ends_on, else null. Clients still cannot send challenge_id.
 */

let db: PGlite;
let alice: string;
let bob: string;
let banned: string;
let admin: string;
let base: { id: string; slug: string };
let other: { id: string; slug: string };
let draft: { id: string; slug: string };
let outside: { id: string; slug: string };
let today: string;

const SMC_NOT_LIVE = "SMC01";
const SMC_NOT_ENDED = "SMC02";
const SMC_NOT_ENTRY = "SMC03";
const OVERLAP = "23P01";

/** YYYY-MM-DD shifted by n days (pure calendar arithmetic). */
function day(n: number, from = today): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type ChallengeInput = { base?: string | null; starts: string; ends: string; title?: string; description?: string | null };

const insertSql = `insert into challenges (base_recipe_id, title, description, starts_on, ends_on)
  values ($1, $2, $3, $4::date, $5::date) returning id`;
const insertParams = (c: ChallengeInput) => [
  c.base === undefined ? base.id : c.base,
  c.title ?? "Remix my chai",
  c.description === undefined ? "Make it yours" : c.description,
  c.starts,
  c.ends,
];

/** Creates a challenge as the admin (through RLS and the validation trigger). */
const adminCreate = (c: ChallengeInput) =>
  asAdmin(db, admin, async (tx) => (await tx.query<{ id: string }>(insertSql, insertParams(c))).rows[0].id);

/** Creates a challenge as the database owner (seeding; the validation trigger still runs). */
const seedChallenge = async (c: ChallengeInput) => (await asSuper<{ id: string }>(db, insertSql, insertParams(c)))[0].id;

/** Uploads a photo and posts a remix as the user, returning the stored challenge_id. */
async function post(uid: string, recipeId = base.id, opts: { timezone?: string } = {}) {
  const path = await uploadObject(db, uid);
  return asUser(db, uid, async (tx) => {
    if (opts.timezone) await tx.query(`select set_config('timezone', $1, true)`, [opts.timezone]);
    return (
      await tx.query<{ id: string; challenge_id: string | null }>(
        `insert into remixes (recipe_id, photo_path, changes) values ($1, $2, 'oat milk') returning id, challenge_id`,
        [recipeId, path],
      )
    ).rows[0];
  });
}

const entry = (owner: string, challengeId: string | null, status: RemixStatus = "approved", recipeId = base.id) =>
  seedRemix(db, { recipe_id: recipeId, user_id: owner, status, challenge_id: challengeId }).then((r) => r.id);

async function storedChallenge(id: string) {
  const [row] = await asSuper<{ title: string; winner_remix_id: string | null; starts_on: string; ends_on: string }>(
    db,
    `select title, winner_remix_id, starts_on::text, ends_on::text from challenges where id = $1`,
    [id],
  );
  return row;
}

async function storedRemixChallenge(remixId: string) {
  const [row] = await asSuper<{ challenge_id: string | null }>(db, `select challenge_id from remixes where id = $1`, [remixId]);
  return row.challenge_id;
}

const setWinner = (as: string, challengeId: string, remixId: string | null) =>
  asAdmin(db, as, (tx) => tx.query(`update challenges set winner_remix_id = $1 where id = $2`, [remixId, challengeId]));

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db, { meta: { full_name: "Alice Wong" } });
  bob = await createUser(db);
  banned = await createUser(db);
  admin = await createUser(db);
  await makeAdmin(db, admin);
  await banUser(db, banned);
  base = await insertRecipe(db, { status: "live", title: "Masala Chai" });
  other = await insertRecipe(db, { status: "live", title: "Paneer Tikka" });
  draft = await insertRecipe(db, { status: "draft" });
  const owner = await createUser(db);
  outside = await insertRecipe(db, { source: "outside", owner_id: owner, created_at: "2026-01-15T00:00:00Z" });
  // Built from Postgres' clock in NZ, independently of nz_today().
  [{ d: today }] = await asSuper<{ d: string }>(db, `select ((now() at time zone 'Pacific/Auckland')::date)::text as d`);
});

beforeEach(async () => {
  // One challenge at a time: each test starts with none.
  await asSuper(db, `delete from challenges`);
});

describe("challenges RLS and validation (task 3 slice C)", () => {
  it("nz_today follows Pacific/Auckland", async () => {
    for (const tz of ["UTC", "Pacific/Honolulu", "Pacific/Auckland"]) {
      const rows = await asUser(db, alice, async (tx) => {
        await tx.query(`select set_config('timezone', $1, true)`, [tz]);
        return (await tx.query<{ d: string }>(`select public.nz_today()::text as d`)).rows;
      });
      expect({ tz, d: rows[0].d }).toEqual({ tz, d: today });
    }
    const [{ t }] = await asSuper<{ t: string }>(db, `select pg_typeof(public.nz_today())::text as t`);
    expect(t).toBe("date");
    const anonRows = await asAnon(db, async (tx) => (await tx.query<{ d: string }>(`select public.nz_today()::text as d`)).rows);
    expect(anonRows[0].d).toBe(today);
  });

  it("anon, users and banned users read challenges; only admin creates, edits and deletes", async () => {
    const id = await adminCreate({ starts: day(0), ends: day(6) });

    for (const read of [
      () => asAnon(db, (tx) => tx.query<{ id: string }>(`select id from challenges`)),
      () => asUser(db, alice, (tx) => tx.query<{ id: string }>(`select id from challenges`)),
      () => asUser(db, banned, (tx) => tx.query<{ id: string }>(`select id from challenges`)),
    ]) {
      expect((await visibleRows(read)).map((r) => r.id)).toEqual([id]);
    }

    // creating: anon has no privilege, users and banned users are refused by RLS
    for (const run of [
      () => asAnon(db, (tx) => tx.query(insertSql, insertParams({ starts: day(20), ends: day(26) }))),
      () => asUser(db, alice, (tx) => tx.query(insertSql, insertParams({ starts: day(20), ends: day(26) }))),
      () => asUser(db, banned, (tx) => tx.query(insertSql, insertParams({ starts: day(20), ends: day(26) }))),
    ]) {
      expect((await pgErrorOf(run)).code).toBe("42501");
    }

    // editing and deleting
    for (const uid of [alice, bob, banned]) {
      await expectBlockedWrite(() => asUser(db, uid, (tx) => tx.query(`update challenges set title = 'hacked' where id = $1`, [id])));
      await expectBlockedWrite(() => asUser(db, uid, (tx) => tx.query(`delete from challenges where id = $1`, [id])));
    }
    await expectBlockedWrite(() => asAnon(db, (tx) => tx.query(`update challenges set title = 'hacked' where id = $1`, [id])));
    await expectBlockedWrite(() => asAnon(db, (tx) => tx.query(`delete from challenges where id = $1`, [id])));
    expect((await storedChallenge(id)).title).toBe("Remix my chai");
    expect((await asSuper(db, `select 1 from challenges`)).length).toBe(1);

    const edit = await asAdmin(db, admin, (tx) =>
      tx.query(`update challenges set title = 'Chai, your way', description = 'Any milk' where id = $1`, [id]),
    );
    expect(edit.affectedRows).toBe(1);
    expect((await storedChallenge(id)).title).toBe("Chai, your way");

    const del = await asAdmin(db, admin, (tx) => tx.query(`delete from challenges where id = $1`, [id]));
    expect(del.affectedRows).toBe(1);
    expect(await asSuper(db, `select 1 from challenges`)).toEqual([]);
  });

  it("base recipe must be a live Shef recipe", async () => {
    for (const bad of [draft.id, outside.id, null, uuid()]) {
      const err = await pgErrorOf(() => adminCreate({ base: bad, starts: day(0), ends: day(6) }));
      // an unknown id may also fail the foreign key; a draft, outside or missing recipe is SMC01
      if (bad !== null && ![draft.id, outside.id].includes(bad)) expect([SMC_NOT_LIVE, "23503"]).toContain(err.code);
      else expect(err.code).toBe(SMC_NOT_LIVE);
    }
    // the database owner is checked too
    expect((await pgErrorOf(() => seedChallenge({ base: draft.id, starts: day(0), ends: day(6) }))).code).toBe(SMC_NOT_LIVE);
    expect(await asSuper(db, `select 1 from challenges`)).toEqual([]);

    // changing the base recipe of an existing challenge to a draft is refused too
    const id = await adminCreate({ starts: day(0), ends: day(6) });
    const err = await pgErrorOf(() =>
      asAdmin(db, admin, (tx) => tx.query(`update challenges set base_recipe_id = $1 where id = $2`, [draft.id, id])),
    );
    expect(err.code).toBe(SMC_NOT_LIVE);
    const [row] = await asSuper<{ base_recipe_id: string }>(db, `select base_recipe_id from challenges where id = $1`, [id]);
    expect(row.base_recipe_id).toBe(base.id);
  });

  it("description is at most 2000 characters", async () => {
    const err = await pgErrorOf(() => adminCreate({ starts: day(0), ends: day(6), description: "a".repeat(2001) }));
    expect(err.code).toBe("23514");
    await expect(adminCreate({ starts: day(0), ends: day(6), description: "a".repeat(2000) })).resolves.toBeTruthy();
  });

  it("overlapping challenges are refused and back-to-back weeks are fine", async () => {
    const week = await adminCreate({ starts: day(0), ends: day(6) });

    // same week, one shared day at either end, and one inside another
    for (const [starts, ends] of [
      [day(0), day(6)],
      [day(6), day(12)],
      [day(-6), day(0)],
      [day(2), day(3)],
      [day(-10), day(20)],
    ]) {
      const err = await pgErrorOf(() => adminCreate({ base: other.id, starts, ends }));
      expect({ starts, ends, code: err.code }).toEqual({ starts, ends, code: OVERLAP });
    }
    // the database owner cannot overlap either
    expect((await pgErrorOf(() => seedChallenge({ starts: day(3), ends: day(9) }))).code).toBe(OVERLAP);

    // back-to-back weeks on both sides
    const next = await adminCreate({ base: other.id, starts: day(7), ends: day(13) });
    const prev = await adminCreate({ starts: day(-7), ends: day(-1) });
    expect(next).toBeTruthy();
    expect(prev).toBeTruthy();

    // moving a challenge onto another is refused; moving it within its own free range is fine
    const move = await pgErrorOf(() =>
      asAdmin(db, admin, (tx) => tx.query(`update challenges set ends_on = $1::date where id = $2`, [day(7), week])),
    );
    expect(move.code).toBe(OVERLAP);
    const ok = await asAdmin(db, admin, (tx) =>
      tx.query(`update challenges set starts_on = $1::date, ends_on = $2::date where id = $3`, [day(1), day(5), week]),
    );
    expect(ok.affectedRows).toBe(1);
    expect(await storedChallenge(week)).toMatchObject({ starts_on: day(1), ends_on: day(5) });
    expect((await asSuper(db, `select 1 from challenges`)).length).toBe(3);
  });

  it("ends_on before starts_on is refused", async () => {
    const err = await pgErrorOf(() => adminCreate({ starts: day(6), ends: day(0) }));
    expect(err.code).toBe("23514");
    // a one-day challenge is fine
    await expect(adminCreate({ starts: day(0), ends: day(0) })).resolves.toBeTruthy();
  });

  it("a remix of the base recipe while the challenge is open is entered automatically", async () => {
    const open = await adminCreate({ starts: day(-2), ends: day(4) });
    const cook = await createUser(db);
    const row = await post(cook, base.id);
    expect(row.challenge_id).toBe(open);
    expect(await storedRemixChallenge(row.id)).toBe(open);

    // it stays an entry when it is approved later (entry is decided on the day it is posted)
    await asSuper(db, `update remixes set status = 'approved' where id = $1`, [row.id]);
    expect(await storedRemixChallenge(row.id)).toBe(open);

    // first and last day count (inclusive), by the NZ date
    await asSuper(db, `delete from challenges`);
    const firstDay = await adminCreate({ starts: day(0), ends: day(6) });
    expect((await post(cook, base.id)).challenge_id).toBe(firstDay);
    await asSuper(db, `delete from challenges`);
    const lastDay = await adminCreate({ starts: day(-6), ends: day(0) });
    expect((await post(cook, base.id)).challenge_id).toBe(lastDay);
  });

  it("entry is decided by the posting date in NZ, not the session or UTC date", async () => {
    const [{ hnl }] = await asSuper<{ hnl: string }>(db, `select ((now() at time zone 'Pacific/Honolulu')::date)::text as hnl`);
    const cook = await createUser(db);

    // open only on today's NZ date: entered even when the session runs in Honolulu time
    const nzOnly = await adminCreate({ starts: today, ends: today });
    expect((await post(cook, base.id, { timezone: "Pacific/Honolulu" })).challenge_id).toBe(nzOnly);
    expect((await post(cook, base.id, { timezone: "UTC" })).challenge_id).toBe(nzOnly);

    // open only on Honolulu's date (NZ yesterday for 23 hours of the day): not entered
    if (hnl !== today) {
      await asSuper(db, `delete from challenges`);
      await adminCreate({ starts: hnl, ends: hnl });
      expect((await post(cook, base.id, { timezone: "Pacific/Honolulu" })).challenge_id).toBeNull();
    }
  });

  it("a remix of another recipe, or posted before or after the NZ dates, is not entered", async () => {
    const cook = await createUser(db);
    await adminCreate({ starts: day(-2), ends: day(4) });
    expect((await post(cook, other.id)).challenge_id).toBeNull();

    // not started yet (starts tomorrow NZ)
    await asSuper(db, `delete from challenges`);
    await adminCreate({ starts: day(1), ends: day(7) });
    expect((await post(cook, base.id)).challenge_id).toBeNull();

    // already ended (ended yesterday NZ)
    await asSuper(db, `delete from challenges`);
    await adminCreate({ starts: day(-7), ends: day(-1) });
    expect((await post(cook, base.id)).challenge_id).toBeNull();

    // no challenge at all
    await asSuper(db, `delete from challenges`);
    expect((await post(cook, base.id)).challenge_id).toBeNull();
  });

  it("the client cannot choose the challenge", async () => {
    const open = await adminCreate({ starts: day(-2), ends: day(4) });
    const cook = await createUser(db);
    for (const recipeId of [base.id, other.id]) {
      const path = await uploadObject(db, cook);
      const err = await pgErrorOf(() =>
        asUser(db, cook, (tx) =>
          tx.query(`insert into remixes (recipe_id, photo_path, changes, challenge_id) values ($1, $2, 'x', $3)`, [recipeId, path, open]),
        ),
      );
      expect(err.code).toBe("42501");
    }
    // nor move a posted remix into or out of it
    const posted = await post(cook, other.id);
    await expectBlockedWrite(() =>
      asUser(db, cook, (tx) => tx.query(`update remixes set challenge_id = $1 where id = $2`, [open, posted.id])),
    );
    expect(await storedRemixChallenge(posted.id)).toBeNull();
    const entered = await post(cook, base.id);
    await expectBlockedWrite(() =>
      asUser(db, cook, (tx) => tx.query(`update remixes set challenge_id = null where id = $1`, [entered.id])),
    );
    expect(await storedRemixChallenge(entered.id)).toBe(open);
  });

  it("only the admin picks a winner, only after the end, only from approved entries of that challenge", async () => {
    const older = await seedChallenge({ base: other.id, starts: day(-40), ends: day(-34) });
    const past = await seedChallenge({ starts: day(-20), ends: day(-14) });
    const open = await seedChallenge({ starts: day(-3), ends: day(0) }); // ends today: not ended yet

    const approved = await entry(alice, past);
    const approved2 = await entry(bob, past);
    const pending = await entry(bob, past, "pending");
    const hidden = await entry(bob, past, "hidden");
    const notEntered = await entry(alice, null); // approved remix of the base recipe, not an entry
    const otherChallenge = await entry(alice, older, "approved", other.id);
    const openEntry = await entry(alice, open);

    // not ended (ends today in NZ)
    expect((await pgErrorOf(() => setWinner(admin, open, openEntry))).code).toBe(SMC_NOT_ENDED);
    expect((await storedChallenge(open)).winner_remix_id).toBeNull();

    // not an approved entry of this challenge
    for (const bad of [pending, hidden, notEntered, otherChallenge, openEntry]) {
      expect((await pgErrorOf(() => setWinner(admin, past, bad))).code).toBe(SMC_NOT_ENTRY);
    }
    expect((await storedChallenge(past)).winner_remix_id).toBeNull();

    // the database owner is held to the same rules
    expect((await pgErrorOf(() => asSuper(db, `update challenges set winner_remix_id = $1 where id = $2`, [pending, past]))).code).toBe(
      SMC_NOT_ENTRY,
    );

    // an approved entry after the end: fine, and the admin can change the pick
    expect((await setWinner(admin, past, approved)).affectedRows).toBe(1);
    expect((await storedChallenge(past)).winner_remix_id).toBe(approved);
    expect((await setWinner(admin, past, approved2)).affectedRows).toBe(1);
    expect((await storedChallenge(past)).winner_remix_id).toBe(approved2);

    // editing the title of a challenge with a winner still works
    const edit = await asAdmin(db, admin, (tx) => tx.query(`update challenges set title = 'Chai week' where id = $1`, [past]));
    expect(edit.affectedRows).toBe(1);
  });

  it("users and banned users cannot set winner_remix_id", async () => {
    const past = await seedChallenge({ starts: day(-20), ends: day(-14) });
    const own = await entry(alice, past);
    const bannedEntry = await entry(banned, past);

    await expectBlockedWrite(() => asAnon(db, (tx) => tx.query(`update challenges set winner_remix_id = $1 where id = $2`, [own, past])));
    await expectBlockedWrite(() =>
      asUser(db, alice, (tx) => tx.query(`update challenges set winner_remix_id = $1 where id = $2`, [own, past])),
    );
    await expectBlockedWrite(() =>
      asUser(db, banned, (tx) => tx.query(`update challenges set winner_remix_id = $1 where id = $2`, [bannedEntry, past])),
    );
    expect((await storedChallenge(past)).winner_remix_id).toBeNull();
  });

  it("deleting the winning remix clears the winner", async () => {
    const past = await seedChallenge({ starts: day(-20), ends: day(-14) });
    const winner = await entry(alice, past);
    await setWinner(admin, past, winner);
    expect((await storedChallenge(past)).winner_remix_id).toBe(winner);

    const del = await asUser(db, alice, (tx) => tx.query(`delete from remixes where id = $1`, [winner]));
    expect(del.affectedRows).toBe(1);
    expect((await storedChallenge(past)).winner_remix_id).toBeNull();

    // the admin can also clear a pick by hand
    const again = await entry(bob, past);
    await setWinner(admin, past, again);
    expect((await setWinner(admin, past, null)).affectedRows).toBe(1);
    expect((await storedChallenge(past)).winner_remix_id).toBeNull();
  });

  /* ---------- slice C review follow-ups ---------- */

  it("moving ends_on into the future on a challenge with a winner is refused with SMC02 (N4)", async () => {
    const past = await seedChallenge({ starts: day(-20), ends: day(-14) });
    const winner = await entry(alice, past);
    await setWinner(admin, past, winner);

    for (const ends of [day(0), day(3)]) {
      const err = await pgErrorOf(() =>
        asAdmin(db, admin, (tx) => tx.query(`update challenges set ends_on = $1::date where id = $2`, [ends, past])),
      );
      expect({ ends, code: err.code }).toEqual({ ends, code: SMC_NOT_ENDED });
    }
    // the database owner is held to it too
    expect((await pgErrorOf(() => asSuper(db, `update challenges set ends_on = $1::date where id = $2`, [day(2), past]))).code).toBe(
      SMC_NOT_ENDED,
    );
    expect(await storedChallenge(past)).toMatchObject({ ends_on: day(-14), winner_remix_id: winner });

    // moving it while staying in the past is fine, and so is clearing the winner and then reopening
    const ok = await asAdmin(db, admin, (tx) => tx.query(`update challenges set ends_on = $1::date where id = $2`, [day(-13), past]));
    expect(ok.affectedRows).toBe(1);
    const reopen = await asAdmin(db, admin, (tx) =>
      tx.query(`update challenges set winner_remix_id = null, ends_on = $1::date where id = $2`, [day(3), past]),
    );
    expect(reopen.affectedRows).toBe(1);
  });

  it("an owner or service_role insert keeps the challenge_id it was given (N5)", async () => {
    const open = await adminCreate({ starts: day(-2), ends: day(4) });
    const older = await seedChallenge({ base: other.id, starts: day(-30), ends: day(-24) });

    // database owner (seeding): keeps a different challenge, and keeps null, even on the open base recipe
    const kept = await entry(alice, older, "approved", base.id);
    expect(await storedRemixChallenge(kept)).toBe(older);
    const none = await entry(alice, null, "pending", base.id);
    expect(await storedRemixChallenge(none)).toBeNull();

    // service_role (server jobs)
    const path = `${bob}/${uuid()}.jpg`;
    await asSuper(db, `insert into storage.objects (bucket_id, name, owner) values ('remix-photos', $1, $2)`, [path, bob]);
    const [row] = await db.transaction(async (tx) => {
      await tx.query(`set local role service_role`);
      return (
        await tx.query<{ id: string; challenge_id: string | null }>(
          `insert into remixes (recipe_id, user_id, photo_path, changes, status, challenge_id)
           values ($1, $2, $3, 'seeded', 'approved', $4) returning id, challenge_id`,
          [base.id, bob, path, older],
        )
      ).rows;
    });
    expect(row.challenge_id).toBe(older);
    expect(await storedRemixChallenge(row.id)).toBe(older);
    expect(open).not.toBe(older);
  });
});
