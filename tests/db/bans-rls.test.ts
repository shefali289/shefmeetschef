// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, banUser, createDb, createUser, expectBlockedWrite, makeAdmin, pgErrorOf, visibleRows,
} from "./helpers/db";

/*
 * Task 3 slice A contract (bans):
 *   bans (user_id uuid pk -> profiles on delete cascade, reason text <= 500,
 *         banned_by uuid -> profiles on delete set null, created_at). RLS on.
 *   select: own row or admin. No insert, update or delete for users or admins (slice D adds
 *   admin functions). is_banned(): security definer, search_path = '', auth.uid() only, no
 *   arguments, execute to authenticated only.
 */

let db: PGlite;
let alice: string;
let bob: string;
let carol: string;
let admin: string;

const isBanned = (uid: string) =>
  asUser(db, uid, async (tx) => (await tx.query<{ b: boolean }>(`select public.is_banned() as b`)).rows[0].b);

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db);
  bob = await createUser(db);
  carol = await createUser(db);
  admin = await createUser(db);
  await makeAdmin(db, admin);
  await banUser(db, carol, { reason: "spam links", by: admin });
});

describe("bans RLS", () => {
  it("banned user reads their own ban row", async () => {
    const rows = await asUser(db, carol, async (tx) =>
      (await tx.query<{ user_id: string; reason: string; banned_by: string }>(`select user_id, reason, banned_by from bans`)).rows,
    );
    expect(rows).toEqual([{ user_id: carol, reason: "spam links", banned_by: admin }]);
    const [{ created_at }] = await asSuper<{ created_at: Date | null }>(db, `select created_at from bans where user_id = $1`, [carol]);
    expect(created_at).not.toBeNull();
  });

  it("other users and anon cannot read bans", async () => {
    const bobSees = await asUser(db, bob, async (tx) => (await tx.query(`select * from bans`)).rows);
    expect(bobSees).toHaveLength(0);
    const anonSees = await visibleRows(() => asAnon(db, (tx) => tx.query(`select * from bans`)));
    expect(anonSees).toHaveLength(0);
  });

  it("admin reads all bans", async () => {
    const dave = await createUser(db);
    await banUser(db, dave, { reason: "abuse" });
    const rows = await asAdmin(db, admin, async (tx) => (await tx.query<{ user_id: string }>(`select user_id from bans`)).rows);
    expect(rows.map((r) => r.user_id).sort()).toEqual([carol, dave].sort());
  });

  it("users and admins cannot insert, update or delete bans directly", async () => {
    // users cannot ban anyone, admins included (that goes through admin_ban_user in slice D)
    for (const [who, target] of [[alice, bob], [alice, alice], [admin, bob], [carol, bob]] as const) {
      await expect(
        asUser(db, who, (tx) => tx.query(`insert into bans (user_id, reason) values ($1, 'x')`, [target])),
      ).rejects.toThrow();
    }
    await expect(asAnon(db, (tx) => tx.query(`insert into bans (user_id) values ($1)`, [bob]))).rejects.toThrow();
    expect(await asSuper(db, `select user_id from bans where user_id = $1`, [bob])).toHaveLength(0);
    // the banned user cannot lift or edit their own ban, and nobody else can either
    for (const who of [carol, alice, admin]) {
      await expectBlockedWrite(() => asUser(db, who, (tx) => tx.query(`delete from bans where user_id = $1`, [carol])));
      await expectBlockedWrite(() => asUser(db, who, (tx) => tx.query(`update bans set reason = 'none' where user_id = $1`, [carol])));
      await expectBlockedWrite(() => asUser(db, who, (tx) => tx.query(`update bans set user_id = $2 where user_id = $1`, [carol, bob])));
    }
    await expectBlockedWrite(() => asAnon(db, (tx) => tx.query(`delete from bans`)));
    expect(await asSuper(db, `select user_id, reason from bans where user_id = $1`, [carol])).toEqual([
      { user_id: carol, reason: "spam links" },
    ]);
    for (const priv of ["INSERT", "UPDATE", "DELETE"]) {
      const [row] = await asSuper<{ authed: boolean; anon: boolean }>(
        db,
        `select has_table_privilege('authenticated', 'public.bans', $1) as authed, has_table_privilege('anon', 'public.bans', $1) as anon`,
        [priv],
      );
      expect({ priv, ...row }).toEqual({ priv, authed: false, anon: false });
    }
    // bad input: the reason is at most 500 characters, and a ban is one row per user
    const eve = await createUser(db);
    await expect(banUser(db, eve, { reason: "r".repeat(501) })).rejects.toThrow();
    await banUser(db, eve, { reason: "r".repeat(500) });
    expect((await pgErrorOf(() => banUser(db, eve))).code).toBe("23505");
  });

  it("is_banned is true only for the banned caller", async () => {
    expect(await isBanned(carol)).toBe(true);
    expect(await isBanned(bob)).toBe(false);
    expect(await isBanned(alice)).toBe(false);
    expect(await isBanned(admin)).toBe(false);
    // it takes no user id: a caller can only ask about themselves
    const [fn] = await asSuper<{ args: string; prosecdef: boolean; proconfig: string[] | null }>(
      db,
      `select pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'is_banned'`,
    );
    expect(fn.args).toBe("");
    expect(fn.prosecdef).toBe(true);
    expect(fn.proconfig ?? []).toContainEqual(expect.stringMatching(/^search_path=(""|)$/));
    // deleting the profile removes the ban with it
    const gone = await createUser(db);
    await banUser(db, gone);
    await asSuper(db, `delete from auth.users where id = $1`, [gone]);
    expect(await asSuper(db, `select user_id from bans where user_id = $1`, [gone])).toHaveLength(0);
  });

  it("anon cannot execute is_banned", async () => {
    const err = await pgErrorOf(() => asAnon(db, (tx) => tx.query(`select public.is_banned()`)));
    expect(err.code).toBe("42501");
    const [row] = await asSuper<{ anon: boolean; authed: boolean; pub: boolean }>(
      db,
      `select has_function_privilege('anon', 'public.is_banned()', 'execute') as anon,
              has_function_privilege('authenticated', 'public.is_banned()', 'execute') as authed,
              exists (
                select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = 'public.is_banned()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
              ) as pub`,
    );
    expect(row).toEqual({ anon: false, authed: true, pub: false });
  });
});
