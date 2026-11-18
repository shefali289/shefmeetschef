// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asAnon, asSuper, asUser, createDb, createUser, expectBlockedWrite, insertRecipe, makeAdmin, seedRemix, visibleRows,
} from "./helpers/db";

let db: PGlite;
let alice: string;
let bob: string;
let admin: string;
let recipe: { id: string; slug: string };
let remixId: string;
let bobRemixId: string;

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db);
  bob = await createUser(db);
  admin = await createUser(db);
  await makeAdmin(db, admin);
  recipe = await insertRecipe(db, { status: "live" });
  const rows = await asSuper<{ id: string }>(
    db,
    `insert into remixes (recipe_id, user_id, photo_path, changes) values ($1, $2, $3, 'more chilli') returning id`,
    [recipe.id, alice, `${alice}/remix.jpg`],
  );
  remixId = rows[0].id;
  // CHANGED IN TASK 3 (slice A, on purpose): likes need an approved remix, so Bob's remix is
  // seeded approved, with its photo and "what I changed" text (both now required).
  bobRemixId = (await seedRemix(db, { recipe_id: recipe.id, user_id: bob, status: "approved", changes: "no onion" })).id;
});

describe("likes, usage and challenges RLS", () => {
  it("likes are own-row only", async () => {
    // Bob likes his own approved remix (allowed); before task 3 this remix was pending.
    const like = await asUser(db, bob, async (tx) =>
      (await tx.query<{ user_id: string }>(`insert into likes (remix_id) values ($1) returning user_id`, [bobRemixId])).rows[0],
    );
    expect(like.user_id).toBe(bob);
    await expect(
      asUser(db, bob, (tx) => tx.query(`insert into likes (user_id, remix_id) values ($1, $2)`, [alice, bobRemixId])),
    ).rejects.toThrow();
    const aliceSees = await asUser(db, alice, async (tx) => (await tx.query(`select * from likes`)).rows);
    expect(aliceSees).toHaveLength(0);
    await expectBlockedWrite(() => asUser(db, alice, (tx) => tx.query(`delete from likes where user_id = $1`, [bob])));
    expect(await asSuper(db, `select user_id from likes where remix_id = $1`, [bobRemixId])).toEqual([{ user_id: bob }]);
    const anonSees = await visibleRows(() => asAnon(db, (tx) => tx.query(`select * from likes`)));
    expect(anonSees).toHaveLength(0);
    const del = await asUser(db, bob, (tx) => tx.query(`delete from likes where remix_id = $1`, [bobRemixId]));
    expect(del.affectedRows).toBe(1);
  });

  it("liking a remix you cannot see throws", async () => {
    // Alice's remix is not visible to Bob (remixes are own-row or admin)
    await expect(
      asUser(db, bob, (tx) => tx.query(`insert into likes (remix_id) values ($1)`, [remixId])),
    ).rejects.toThrow();
    expect(await asSuper(db, `select * from likes where remix_id = $1`, [remixId])).toHaveLength(0);
  });

  it("usage is not writable by users", async () => {
    await asSuper(db, `insert into usage (user_id, kind, period, count) values ($1, 'ask', '2026-11', 3)`, [alice]);
    const own = await asUser(db, alice, async (tx) => (await tx.query(`select count from usage where user_id = $1`, [alice])).rows);
    expect(own).toEqual([{ count: 3 }]);
    const other = await asUser(db, bob, async (tx) => (await tx.query(`select * from usage`)).rows);
    expect(other).toHaveLength(0);
    const anon = await visibleRows(() => asAnon(db, (tx) => tx.query(`select * from usage`)));
    expect(anon).toHaveLength(0);
    await expect(
      asUser(db, alice, (tx) => tx.query(`insert into usage (user_id, kind, period, count) values ($1, 'remix', '2026-11', 0)`, [alice])),
    ).rejects.toThrow();
    await expectBlockedWrite(() => asUser(db, alice, (tx) => tx.query(`update usage set count = 0 where user_id = $1`, [alice])));
    await expectBlockedWrite(() => asUser(db, alice, (tx) => tx.query(`delete from usage where user_id = $1`, [alice])));
    expect(await asSuper(db, `select count from usage where user_id = $1`, [alice])).toEqual([{ count: 3 }]);
  });

  it("challenges readable by anon, writable by admin only", async () => {
    const [seed] = await asSuper<{ id: string }>(
      db,
      `insert into challenges (base_recipe_id, title, starts_on, ends_on) values ($1, 'Diwali week', '2026-11-01', '2026-11-08') returning id`,
      [recipe.id],
    );
    const anon = await asAnon(db, async (tx) => (await tx.query(`select title from challenges where id = $1`, [seed.id])).rows);
    expect(anon).toEqual([{ title: "Diwali week" }]);
    await expect(
      asUser(db, alice, (tx) =>
        tx.query(`insert into challenges (base_recipe_id, title, starts_on, ends_on) values ($1, 'x', '2026-12-01', '2026-12-08')`, [recipe.id]),
      ),
    ).rejects.toThrow();
    await expect(
      asAnon(db, (tx) =>
        tx.query(`insert into challenges (base_recipe_id, title, starts_on, ends_on) values ($1, 'x', '2026-12-01', '2026-12-08')`, [recipe.id]),
      ),
    ).rejects.toThrow();
    await expectBlockedWrite(() => asUser(db, alice, (tx) => tx.query(`update challenges set title = 'pwned' where id = $1`, [seed.id])));
    await expectBlockedWrite(() => asUser(db, alice, (tx) => tx.query(`delete from challenges where id = $1`, [seed.id])));
    expect(await asSuper(db, `select title from challenges where id = $1`, [seed.id])).toEqual([{ title: "Diwali week" }]);

    const ins = await asAdmin(db, admin, (tx) =>
      tx.query(`insert into challenges (base_recipe_id, title, starts_on, ends_on) values ($1, 'Admin', '2026-12-01', '2026-12-08')`, [recipe.id]),
    );
    expect(ins.affectedRows).toBe(1);
    const upd = await asAdmin(db, admin, (tx) => tx.query(`update challenges set title = 'Renamed' where id = $1`, [seed.id]));
    expect(upd.affectedRows).toBe(1);
    const del = await asAdmin(db, admin, (tx) => tx.query(`delete from challenges where title = 'Admin'`));
    expect(del.affectedRows).toBe(1);
  });
});
