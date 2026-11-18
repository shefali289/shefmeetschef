// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAnon, asSuper, asUser, createDb, createUser, expectBlockedWrite, pgErrorOf, type Tx,
} from "./helpers/db";

/*
 * Slice A usage contract (task 2):
 *   usage_kind gains 'outside_reel'.
 *   usage.period accepts 'YYYY-MM' or 'YYYY-MM-DD'.
 *   usage_period(kind usage_kind, at timestamptz) returns text: 'ask' -> NZ day 'YYYY-MM-DD',
 *     every other kind -> NZ month 'YYYY-MM' (Pacific/Auckland).
 *   consume_usage(kind usage_kind, lim int) returns int (remaining after this use).
 *     security definer, search_path = '', auth.uid() only (raises when null), rejects lim < 1,
 *     raises 'usage_limit_reached' with a custom SQLSTATE when the limit is already used up.
 *   usage_remaining(kind usage_kind, lim int) returns int, read-only.
 *   Execute on both: authenticated only (not public, not anon).
 *   Parameter names are kind / lim (supabase.rpc passes them by name).
 */

let db: PGlite;

const consume = (tx: Tx, kind: string, lim: number | null) =>
  tx.query<{ remaining: number }>(`select public.consume_usage(kind => $1::public.usage_kind, lim => $2) as remaining`, [kind, lim]);
const remaining = (tx: Tx, kind: string, lim: number) =>
  tx.query<{ remaining: number }>(`select public.usage_remaining(kind => $1::public.usage_kind, lim => $2) as remaining`, [kind, lim]);

async function periodAt(kind: string, at: string): Promise<string> {
  const [row] = await asSuper<{ p: string }>(db, `select public.usage_period($1::public.usage_kind, $2::timestamptz) as p`, [kind, at]);
  return row.p;
}

async function currentPeriod(kind: string): Promise<string> {
  const [row] = await asSuper<{ p: string }>(db, `select public.usage_period($1::public.usage_kind, now()) as p`, [kind]);
  return row.p;
}

function expectLimitReached(err: { code: string; message: string }) {
  expect(err.message).toMatch(/usage_limit_reached/);
  // a custom SQLSTATE the app can match on, not the generic raise_exception code or a privilege error
  expect(err.code).toMatch(/^[0-9A-Z]{5}$/);
  expect(err.code).not.toBe("P0001");
  expect(err.code).not.toBe("42501");
}

beforeAll(async () => {
  db = await createDb();
});

describe("usage counting (consume_usage, usage_remaining, usage_period)", () => {
  it("usage_kind includes outside_reel", async () => {
    const rows = await asSuper<{ label: string }>(
      db,
      `select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'usage_kind' order by e.enumsortorder`,
    );
    expect(rows.map((r) => r.label)).toEqual(["ask", "remix", "outside_reel"]);
  });

  it("usage.period accepts NZ days and months but nothing else", async () => {
    const u = await createUser(db);
    await asSuper(db, `insert into usage (user_id, kind, period, count) values ($1, 'ask', '2026-11-17', 1)`, [u]);
    await asSuper(db, `insert into usage (user_id, kind, period, count) values ($1, 'outside_reel', '2026-11', 1)`, [u]);
    for (const bad of ["2026-13", "2026-11-32", "2026-11-1", "2026/11", "26-11", "2026-11-17x", ""]) {
      await expect(
        asSuper(db, `insert into usage (user_id, kind, period, count) values ($1, 'remix', $2, 1)`, [u, bad]),
      ).rejects.toThrow();
    }
  });

  it("usage_period gives NZ days for ask and NZ months for outside_reel", async () => {
    // NZDT (UTC+13): NZ midnight on 18 Nov 2026 is 2026-11-17T11:00Z
    expect(await periodAt("ask", "2026-11-17T10:59:59Z")).toBe("2026-11-17");
    expect(await periodAt("ask", "2026-11-17T11:00:00Z")).toBe("2026-11-18");
    // NZST (UTC+12): NZ midnight on 15 Jun 2026 is 2026-06-14T12:00Z
    expect(await periodAt("ask", "2026-06-14T11:59:59Z")).toBe("2026-06-14");
    expect(await periodAt("ask", "2026-06-14T12:00:00Z")).toBe("2026-06-15");
    // NZST month end: 1 Jul 2026 starts at 2026-06-30T12:00Z
    expect(await periodAt("outside_reel", "2026-06-30T11:59:59Z")).toBe("2026-06");
    expect(await periodAt("outside_reel", "2026-06-30T12:00:00Z")).toBe("2026-07");
    expect(await periodAt("ask", "2026-06-30T12:00:00Z")).toBe("2026-07-01");
    // NZDT month and year end: 1 Jan 2027 starts at 2026-12-31T11:00Z
    expect(await periodAt("outside_reel", "2026-12-31T10:59:59Z")).toBe("2026-12");
    expect(await periodAt("outside_reel", "2026-12-31T11:00:00Z")).toBe("2027-01");
    // remix is monthly too
    expect(await periodAt("remix", "2026-12-31T11:00:00Z")).toBe("2027-01");
    // the result does not depend on the session time zone
    await db.exec(`set timezone = 'America/Los_Angeles'`);
    try {
      expect(await periodAt("ask", "2026-11-17T11:00:00Z")).toBe("2026-11-18");
    } finally {
      await db.exec(`set timezone = 'UTC'`);
    }
  });

  it("consume_usage creates the row for the current period and returns remaining", async () => {
    const u = await createUser(db);
    const first = await asUser(db, u, async (tx) => (await consume(tx, "ask", 10)).rows[0].remaining);
    expect(first).toBe(9);
    const period = await currentPeriod("ask");
    expect(period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await asSuper(db, `select kind, period, count from usage where user_id = $1`, [u])).toEqual([
      { kind: "ask", period, count: 1 },
    ]);
    const second = await asUser(db, u, async (tx) => (await consume(tx, "ask", 10)).rows[0].remaining);
    expect(second).toBe(8);
    expect(await asSuper(db, `select count from usage where user_id = $1 and kind = 'ask'`, [u])).toEqual([{ count: 2 }]);

    const reel = await asUser(db, u, async (tx) => (await consume(tx, "outside_reel", 5)).rows[0].remaining);
    expect(reel).toBe(4);
    const month = await currentPeriod("outside_reel");
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    expect(await asSuper(db, `select period, count from usage where user_id = $1 and kind = 'outside_reel'`, [u])).toEqual([
      { period: month, count: 1 },
    ]);
  });

  it("consume_usage returns 0 on the last allowed use, then raises usage_limit_reached", async () => {
    const u = await createUser(db);
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(await asUser(db, u, async (tx) => (await consume(tx, "outside_reel", 5)).rows[0].remaining));
    }
    expect(seen).toEqual([4, 3, 2, 1, 0]);
    expectLimitReached(await pgErrorOf(() => asUser(db, u, (tx) => consume(tx, "outside_reel", 5))));
    // trying again still fails and never pushes the count past the limit
    expectLimitReached(await pgErrorOf(() => asUser(db, u, (tx) => consume(tx, "outside_reel", 5))));
    expect(await asSuper(db, `select count from usage where user_id = $1 and kind = 'outside_reel'`, [u])).toEqual([{ count: 5 }]);
    // a smaller limit than what was already used is also reached, not negative
    expectLimitReached(await pgErrorOf(() => asUser(db, u, (tx) => consume(tx, "outside_reel", 3))));
    expect(await asUser(db, u, async (tx) => (await remaining(tx, "outside_reel", 3)).rows[0].remaining)).toBe(0);
  });

  it("a new period starts from the full limit", async () => {
    const u = await createUser(db);
    const [{ p: yesterday }] = await asSuper<{ p: string }>(
      db, `select public.usage_period('ask'::public.usage_kind, now() - interval '1 day') as p`,
    );
    const [{ p: lastMonth }] = await asSuper<{ p: string }>(
      db, `select public.usage_period('outside_reel'::public.usage_kind, now() - interval '1 month') as p`,
    );
    expect(yesterday).not.toBe(await currentPeriod("ask"));
    expect(lastMonth).not.toBe(await currentPeriod("outside_reel"));
    await asSuper(db, `insert into usage (user_id, kind, period, count) values ($1, 'ask', $2, 10), ($1, 'outside_reel', $3, 5)`, [
      u, yesterday, lastMonth,
    ]);
    expect(await asUser(db, u, async (tx) => (await remaining(tx, "ask", 10)).rows[0].remaining)).toBe(10);
    expect(await asUser(db, u, async (tx) => (await consume(tx, "ask", 10)).rows[0].remaining)).toBe(9);
    expect(await asUser(db, u, async (tx) => (await consume(tx, "outside_reel", 5)).rows[0].remaining)).toBe(4);
    // the old periods are left alone
    expect(await asSuper(db, `select count from usage where user_id = $1 and period = $2`, [u, yesterday])).toEqual([{ count: 10 }]);
    expect(await asSuper(db, `select count from usage where user_id = $1 and period = $2`, [u, lastMonth])).toEqual([{ count: 5 }]);
  });

  it("consume_usage counts only for the caller", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    for (let i = 0; i < 3; i++) await asUser(db, alice, (tx) => consume(tx, "ask", 10));
    expect(await asUser(db, bob, async (tx) => (await remaining(tx, "ask", 10)).rows[0].remaining)).toBe(10);
    expect(await asUser(db, alice, async (tx) => (await remaining(tx, "ask", 10)).rows[0].remaining)).toBe(7);
    expect(await asSuper(db, `select user_id from usage where user_id in ($1, $2)`, [alice, bob])).toEqual([{ user_id: alice }]);
    // there is no way to name another user: the function takes only kind and lim
    const args = await asSuper<{ args: string }>(
      db,
      `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('consume_usage', 'usage_remaining') order by p.proname`,
    );
    expect(args).toEqual([{ args: "kind usage_kind, lim integer" }, { args: "kind usage_kind, lim integer" }]);
  });

  it("consume_usage raises when there is no signed-in user", async () => {
    const err = await pgErrorOf(() =>
      db.transaction(async (tx) => {
        await tx.query(`set local role authenticated`);
        await tx.query(`select set_config('request.jwt.claim.sub', '', true)`);
        return consume(tx, "ask", 10);
      }),
    );
    expect(err.message).not.toMatch(/usage_limit_reached/);
    // the function exists and the caller may run it; it refuses because auth.uid() is null
    expect(err.code).not.toBe("42883");
    expect(err.code).not.toBe("42501");
    expect(await asSuper(db, `select * from usage where user_id is null`)).toHaveLength(0);
  });

  it("consume_usage rejects a limit below 1", async () => {
    const u = await createUser(db);
    for (const lim of [0, -1, -100, null]) {
      const err = await pgErrorOf(() => asUser(db, u, (tx) => consume(tx, "ask", lim)));
      expect(err.code).not.toBe("42883"); // undefined function would be a false pass
      expect(err.code).not.toBe("42501");
      expect(err.message).not.toMatch(/usage_limit_reached/);
    }
    expect(await asSuper(db, `select * from usage where user_id = $1`, [u])).toHaveLength(0);
  });

  it("usage_remaining does not consume", async () => {
    const u = await createUser(db);
    expect(await asUser(db, u, async (tx) => (await remaining(tx, "ask", 10)).rows[0].remaining)).toBe(10);
    expect(await asSuper(db, `select * from usage where user_id = $1`, [u])).toHaveLength(0);
    await asUser(db, u, (tx) => consume(tx, "ask", 10));
    for (let i = 0; i < 3; i++) {
      expect(await asUser(db, u, async (tx) => (await remaining(tx, "ask", 10)).rows[0].remaining)).toBe(9);
    }
    expect(await asSuper(db, `select count from usage where user_id = $1`, [u])).toEqual([{ count: 1 }]);
    // remaining is per caller and per kind
    expect(await asUser(db, u, async (tx) => (await remaining(tx, "outside_reel", 5)).rows[0].remaining)).toBe(5);
    const [fn] = await asSuper<{ volatile: string }>(
      db,
      `select p.provolatile as volatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'usage_remaining'`,
    );
    expect(["s", "i"]).toContain(fn.volatile);
  });

  it("consume_usage and usage_remaining are security definer with an empty search_path", async () => {
    const rows = await asSuper<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      db,
      `select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('consume_usage', 'usage_remaining') order by p.proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual(["consume_usage", "usage_remaining"]);
    for (const r of rows) {
      expect(r.prosecdef).toBe(true);
      expect(r.proconfig ?? []).toContainEqual(expect.stringMatching(/^search_path=(""|)$/));
    }
  });

  it("anon cannot execute consume_usage or usage_remaining", async () => {
    for (const sql of [
      `select public.consume_usage('ask', 10)`,
      `select public.usage_remaining('ask', 10)`,
    ]) {
      const err = await pgErrorOf(() => asAnon(db, (tx) => tx.query(sql)));
      expect(err.code).toBe("42501");
    }
    for (const sig of ["public.consume_usage(public.usage_kind, integer)", "public.usage_remaining(public.usage_kind, integer)"]) {
      const [row] = await asSuper<{ anon: boolean; authed: boolean; pub: boolean }>(
        db,
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as authed,
                exists (
                  select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
                ) as pub`,
        [sig],
      );
      expect({ sig, ...row }).toEqual({ sig, anon: false, authed: true, pub: false });
    }
    expect(await asSuper(db, `select * from usage where user_id is null`)).toHaveLength(0);
  });

  it("users still cannot insert, update or delete usage rows directly", async () => {
    const u = await createUser(db);
    const other = await createUser(db);
    await asUser(db, u, (tx) => consume(tx, "ask", 10));
    await asUser(db, other, (tx) => consume(tx, "ask", 10));
    const period = await currentPeriod("ask");
    await expect(
      asUser(db, u, (tx) => tx.query(`insert into usage (user_id, kind, period, count) values ($1, 'outside_reel', $2, 0)`, [u, "2026-11"])),
    ).rejects.toThrow();
    await expect(
      asUser(db, u, (tx) => tx.query(`insert into usage (user_id, kind, period, count) values ($1, 'ask', '2099-01-01', 0)`, [u])),
    ).rejects.toThrow();
    await expectBlockedWrite(() => asUser(db, u, (tx) => tx.query(`update usage set count = 0 where user_id = $1`, [u])));
    await expectBlockedWrite(() => asUser(db, u, (tx) => tx.query(`delete from usage where user_id = $1`, [u])));
    await expectBlockedWrite(() => asUser(db, u, (tx) => tx.query(`update usage set count = 0 where user_id = $1`, [other])));
    await expectBlockedWrite(() => asAnon(db, (tx) => tx.query(`delete from usage`)));
    expect(await asSuper(db, `select count from usage where user_id = $1 and period = $2`, [u, period])).toEqual([{ count: 1 }]);
    expect(await asSuper(db, `select count from usage where user_id = $1 and period = $2`, [other, period])).toEqual([{ count: 1 }]);
    // users still read only their own counters
    const seen = await asUser(db, u, async (tx) => (await tx.query<{ user_id: string }>(`select user_id from usage`)).rows);
    expect(seen.every((r) => r.user_id === u)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  });
});
