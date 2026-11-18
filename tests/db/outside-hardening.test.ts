// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAdmin, asSuper, asUser, createDb, createUser, insertRecipe, makeAdmin, pgErrorOf, uuid, type Tx,
} from "./helpers/db";

/*
 * Review findings B1 and B2 on slice A, fixed in 20261118000005_outside_hardening.sql (append-only).
 *
 * B1, a user inserting an outside recipe straight through the REST API must not get round the
 * add-reel flow:
 *   (a) an insert by an API role fails when the user's outside recipes created in the current NZ
 *       month would exceed their 'outside_reel' usage count for this month, so every insert needs a
 *       prior consume_usage. A backdated created_at must not dodge the count. Superuser seeding
 *       (tests, migrations) is not limited.
 *   (b) reel_url must be https://(www.)instagram.com/<optional handle/>(reel|p|tv)/<id>...
 *   (c) size caps: title <= 200, description <= 2000, ingredients <= 60 items, steps <= 40 items,
 *       diet_tags / allergens / categories <= 20 entries each, cuisine <= 40.
 * B2, slugs: outside slugs start with 'reel-' and shef slugs never do (check constraint, so it holds
 *   for everyone). A user trying an existing shef slug gets the same error as any non-reel slug,
 *   never a unique violation that would reveal an unpublished draft.
 */

let db: PGlite;
let admin: string;

const REEL = "https://www.instagram.com/reel/C0ffee123/";
const UNIQUE_VIOLATION = "23505";

type Cols = Record<string, unknown>;

/** A valid outside recipe; overrides replace (or add) columns. */
function outsideRow(owner: string, overrides: Cols = {}): Cols {
  return {
    slug: `reel-pasta-${uuid().slice(0, 6)}`,
    title: "Reel pasta",
    source: "outside",
    status: "live",
    owner_id: owner,
    published_at: new Date().toISOString(),
    reel_url: REEL,
    ingredients: JSON.stringify([{ qty: 1, unit: "cup", item: "pasta", note: null }]),
    steps: JSON.stringify([{ text: "Boil" }]),
    ...overrides,
  };
}

function insertRow(tx: Tx, row: Cols) {
  const cols = Object.keys(row);
  return tx.query<{ id: string }>(
    `insert into recipes (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    cols.map((c) => row[c]),
  );
}

const consumeReel = (tx: Tx) => tx.query(`select public.consume_usage('outside_reel', 1000)`);

/** Consume one reel and insert, in one transaction (what the add-reel action does). */
const addReel = (user: string, overrides: Cols = {}) =>
  asUser(db, user, async (tx) => {
    await consumeReel(tx);
    return (await insertRow(tx, outsideRow(user, overrides))).rows[0];
  });

const outsideCount = async (user: string) =>
  (await asSuper<{ n: number }>(db, `select count(*)::int as n from recipes where owner_id = $1 and source = 'outside'`, [user]))[0].n;

beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db);
  await makeAdmin(db, admin);
});

describe("B1a: outside inserts are tied to outside_reel usage", () => {
  it("inserting an outside recipe without consuming a reel fails", async () => {
    const u = await createUser(db);
    await expect(asUser(db, u, (tx) => insertRow(tx, outsideRow(u)))).rejects.toThrow();
    expect(await outsideCount(u)).toBe(0);
  });

  it("one consume allows exactly one insert", async () => {
    const u = await createUser(db);
    await asUser(db, u, (tx) => tx.query(`select public.consume_usage('outside_reel', 5)`));
    await asUser(db, u, (tx) => insertRow(tx, outsideRow(u)));
    await expect(asUser(db, u, (tx) => insertRow(tx, outsideRow(u)))).rejects.toThrow();
    expect(await outsideCount(u)).toBe(1);
    // the next consume allows the next insert
    await asUser(db, u, (tx) => tx.query(`select public.consume_usage('outside_reel', 5)`));
    await asUser(db, u, (tx) => insertRow(tx, outsideRow(u)));
    expect(await outsideCount(u)).toBe(2);
    // consume and insert in one transaction, as the action does
    await addReel(u);
    expect(await outsideCount(u)).toBe(3);
  });

  it("someone else's usage does not let you insert", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    await asUser(db, bob, consumeReel);
    await expect(asUser(db, alice, (tx) => insertRow(tx, outsideRow(alice)))).rejects.toThrow();
    // and bob's remaining allowance is untouched by alice's attempt
    await asUser(db, bob, (tx) => insertRow(tx, outsideRow(bob)));
    expect(await outsideCount(alice)).toBe(0);
    expect(await outsideCount(bob)).toBe(1);
  });

  it("only outside recipes created in the current NZ month count", async () => {
    // NZ month start as an instant, and one second before it
    const [{ start, before }] = await asSuper<{ start: string; before: string }>(
      db,
      `select (date_trunc('month', now() at time zone 'Pacific/Auckland') at time zone 'Pacific/Auckland')::text as start,
              ((date_trunc('month', now() at time zone 'Pacific/Auckland') at time zone 'Pacific/Auckland') - interval '1 second')::text as before`,
    );
    const seed = (owner: string, at: string) =>
      asSuper(
        db,
        `insert into recipes (slug, title, source, status, owner_id, published_at, reel_url, created_at)
         values ($1, 'Seed', 'outside', 'live', $2, $3, $4, $3)`,
        [`reel-seed-${uuid().slice(0, 6)}`, owner, at, REEL],
      );
    const lastMonth = await createUser(db);
    await seed(lastMonth, before);
    await asUser(db, lastMonth, consumeReel);
    await asUser(db, lastMonth, (tx) => insertRow(tx, outsideRow(lastMonth)));
    expect(await outsideCount(lastMonth)).toBe(2);

    const thisMonth = await createUser(db);
    await seed(thisMonth, start);
    await asUser(db, thisMonth, consumeReel);
    await expect(asUser(db, thisMonth, (tx) => insertRow(tx, outsideRow(thisMonth)))).rejects.toThrow();
    expect(await outsideCount(thisMonth)).toBe(1);
  });

  it("a backdated created_at does not dodge the count", async () => {
    const u = await createUser(db);
    await asUser(db, u, consumeReel);
    const old = { created_at: "2000-01-01T00:00:00Z", published_at: "2000-01-01T00:00:00Z" };
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(
        await asUser(db, u, (tx) => insertRow(tx, outsideRow(u, old))).then(
          () => "ok",
          () => "rejected",
        ),
      );
    }
    // one consume buys at most one recipe, whatever dates the client sends
    expect(results.filter((r) => r === "ok").length).toBeLessThanOrEqual(1);
    expect(await outsideCount(u)).toBeLessThanOrEqual(1);
  });

  it("superuser seeding is not limited by usage", async () => {
    const u = await createUser(db);
    await insertRecipe(db, { status: "live", source: "outside", owner_id: u });
    await insertRecipe(db, { status: "live", source: "outside", owner_id: u });
    expect(await outsideCount(u)).toBe(2);
  });
});

describe("B1b: reel_url must be an Instagram reel link", () => {
  it("rejects anything but https://(www.)instagram.com/<handle/>(reel|p|tv)/<id>", async () => {
    const u = await createUser(db);
    const bad: (string | null)[] = [
      null,
      "",
      "javascript:alert(1)",
      "JavaScript:alert(document.cookie)//https://www.instagram.com/reel/C0ffee123/",
      "data:text/html,<script>alert(1)</script>",
      "http://www.instagram.com/reel/C0ffee123/",
      "https://evil.example/reel/C0ffee123/",
      "https://www.instagram.com.evil.example/reel/C0ffee123/",
      "https://evilinstagram.com/reel/C0ffee123/",
      "https://m.instagram.com/reel/C0ffee123/",
      "https://user@evil.example/www.instagram.com/reel/C0ffee123/",
      "https://www.instagram.com/stories/someone/123/",
      "https://www.instagram.com/reel/",
      "https://www.instagram.com/",
      " https://www.instagram.com/reel/C0ffee123/",
    ];
    for (const reel_url of bad) {
      const res = await addReel(u, { reel_url }).then(() => "accepted", () => "rejected");
      expect({ reel_url, res }).toEqual({ reel_url, res: "rejected" });
    }
    expect(await outsideCount(u)).toBe(0);
  });

  it("accepts reel, post and tv links, with or without www and a handle", async () => {
    const u = await createUser(db);
    const good = [
      "https://www.instagram.com/reel/C0ffee123/",
      "https://instagram.com/reel/C0ffee123",
      "https://www.instagram.com/p/C0ffee_12-3/",
      "https://www.instagram.com/tv/C0ffee123/",
      "https://www.instagram.com/some.cook_1/reel/C0ffee123/",
    ];
    for (const reel_url of good) await addReel(u, { reel_url });
    expect(await outsideCount(u)).toBe(good.length);
  });
});

describe("B1c: field sizes are capped", () => {
  const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));
  const ingredient = (i: number) => ({ qty: 1, unit: "g", item: `item ${i}`, note: null });
  const step = (i: number) => ({ text: `Step ${i}` });
  const tags = (n: number) => many(n, (i) => `tag${i}`);

  it("rejects oversized title, description, ingredients, steps, tag arrays and cuisine", async () => {
    const u = await createUser(db);
    const tooBig: Record<string, Cols> = {
      title: { title: "a".repeat(201) },
      description: { description: "a".repeat(2001) },
      ingredients: { ingredients: JSON.stringify(many(61, ingredient)) },
      steps: { steps: JSON.stringify(many(41, step)) },
      diet_tags: { diet_tags: tags(21) },
      allergens: { allergens: tags(21) },
      categories: { categories: tags(21) },
      cuisine: { cuisine: "a".repeat(41) },
    };
    for (const [field, overrides] of Object.entries(tooBig)) {
      const res = await addReel(u, overrides).then(() => "accepted", () => "rejected");
      expect({ field, res }).toEqual({ field, res: "rejected" });
    }
    expect(await outsideCount(u)).toBe(0);
  });

  it("accepts every field at its maximum size", async () => {
    const u = await createUser(db);
    await addReel(u, {
      title: "a".repeat(200),
      description: "a".repeat(2000),
      ingredients: JSON.stringify(many(60, ingredient)),
      steps: JSON.stringify(many(40, step)),
      diet_tags: tags(20),
      allergens: tags(20),
      categories: tags(20),
      cuisine: "a".repeat(40),
    });
    expect(await outsideCount(u)).toBe(1);
  });
});

describe("B2: reel- slugs belong to outside recipes only", () => {
  it("user insert of an outside recipe with a non-reel slug fails", async () => {
    const u = await createUser(db);
    for (const slug of ["butter-chicken", "reelpasta", "my-reel-pasta"]) {
      const res = await addReel(u, { slug }).then(() => "accepted", () => "rejected");
      expect({ slug, res }).toEqual({ slug, res: "rejected" });
    }
    expect(await outsideCount(u)).toBe(0);
    await addReel(u, { slug: "reel-butter-chicken-a1b2c3" });
    expect(await outsideCount(u)).toBe(1);
  });

  it("shef recipes cannot take a reel- slug, even for admins", async () => {
    await expect(
      asAdmin(db, admin, (tx) => tx.query(`insert into recipes (slug, title) values ('reel-x', 'Shef draft')`)),
    ).rejects.toThrow();
    await expect(
      asAdmin(db, admin, (tx) =>
        tx.query(`insert into recipes (slug, title, status, published_at) values ('reel-live', 'Live', 'live', now())`),
      ),
    ).rejects.toThrow();
    // it is a table rule, so seeding as superuser cannot do it either
    await expect(insertRecipe(db, { slug: "reel-seeded", source: "shef" })).rejects.toThrow();
    // and an existing shef recipe cannot be renamed into the reel- space
    const shef = await asAdmin(db, admin, async (tx) =>
      (await tx.query<{ id: string }>(`insert into recipes (slug, title) values ('butter-chicken', 'Butter chicken') returning id`)).rows[0],
    );
    await expect(
      asAdmin(db, admin, (tx) => tx.query(`update recipes set slug = 'reel-y' where id = $1`, [shef.id])),
    ).rejects.toThrow();
    expect(await asSuper(db, `select slug from recipes where slug like 'reel-x' or slug like 'reel-live' or slug like 'reel-seeded' or slug = 'reel-y'`)).toHaveLength(0);
    expect(await asSuper(db, `select slug from recipes where id = $1`, [shef.id])).toEqual([{ slug: "butter-chicken" }]);
  });

  it("an existing shef draft slug gives the same error as any non-reel slug (no leak)", async () => {
    const draft = await insertRecipe(db, { slug: "secret-diwali-menu", status: "draft", source: "shef" });
    const u = await createUser(db);
    const taken = await pgErrorOf(() => addReel(u, { slug: draft.slug }));
    const fresh = await pgErrorOf(() => addReel(u, { slug: "never-used-slug" }));
    expect(taken.code).not.toBe(UNIQUE_VIOLATION);
    expect(taken.message).not.toMatch(/duplicate|already exists|unique/i);
    expect(taken).toEqual(fresh);
    expect(await outsideCount(u)).toBe(0);
  });
});

describe("free limits are capped in the database, whatever lim the caller passes", () => {
  // Review finding: consume_usage is callable straight from the browser (supabase.rpc), so a user
  // could pass a huge lim. The DB caps it at the free limits: 5 outside reels a NZ month, 10 asks a
  // NZ day. A smaller lim from the caller still applies.
  const consumeAs = (user: string, kind: string, lim: number) =>
    asUser(db, user, async (tx) =>
      (await tx.query<{ r: number }>(`select public.consume_usage($1::public.usage_kind, $2) as r`, [kind, lim])).rows[0].r,
    );

  it("consume_usage('outside_reel', 100000) still stops at 5 this month", async () => {
    const u = await createUser(db);
    const left: number[] = [];
    for (let i = 0; i < 5; i++) left.push(await consumeAs(u, "outside_reel", 100000));
    expect(left).toEqual([4, 3, 2, 1, 0]);
    const err = await pgErrorOf(() => consumeAs(u, "outside_reel", 100000));
    expect(err.code).toBe("SMU01");
    expect(err.message).toMatch(/usage_limit_reached/);
    expect(await asSuper(db, `select count from usage where user_id = $1 and kind = 'outside_reel'`, [u])).toEqual([{ count: 5 }]);
    // usage_remaining agrees with the cap too
    const rem = await asUser(db, u, async (tx) =>
      (await tx.query<{ r: number }>(`select public.usage_remaining('outside_reel', 100000) as r`)).rows[0].r,
    );
    expect(rem).toBe(0);
  });

  it("consume_usage('ask', 1000) still stops at 10 today", async () => {
    const u = await createUser(db);
    const left: number[] = [];
    for (let i = 0; i < 10; i++) left.push(await consumeAs(u, "ask", 1000));
    expect(left).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    const err = await pgErrorOf(() => consumeAs(u, "ask", 1000));
    expect(err.code).toBe("SMU01");
    expect(await asSuper(db, `select count from usage where user_id = $1 and kind = 'ask'`, [u])).toEqual([{ count: 10 }]);
  });

  it("a smaller lim from the caller is still respected", async () => {
    const u = await createUser(db);
    expect(await consumeAs(u, "ask", 3)).toBe(2);
    expect(await consumeAs(u, "ask", 3)).toBe(1);
    expect(await consumeAs(u, "ask", 3)).toBe(0);
    expect((await pgErrorOf(() => consumeAs(u, "ask", 3))).code).toBe("SMU01");
    // raising lim again only goes up to the free cap
    for (let i = 0; i < 7; i++) await consumeAs(u, "ask", 1000);
    expect((await pgErrorOf(() => consumeAs(u, "ask", 1000))).code).toBe("SMU01");

    const v = await createUser(db);
    expect(await consumeAs(v, "outside_reel", 2)).toBe(1);
    expect(await consumeAs(v, "outside_reel", 2)).toBe(0);
    expect((await pgErrorOf(() => consumeAs(v, "outside_reel", 2))).code).toBe("SMU01");
  });

  it("a direct insert of a 6th outside recipe this month fails even after those calls", async () => {
    const u = await createUser(db);
    for (let i = 0; i < 5; i++) await consumeAs(u, "outside_reel", 100000);
    await pgErrorOf(() => consumeAs(u, "outside_reel", 100000));
    // the 5 paid-for reels go in, straight through the API
    for (let i = 0; i < 5; i++) await asUser(db, u, (tx) => insertRow(tx, outsideRow(u)));
    expect(await outsideCount(u)).toBe(5);
    await expect(asUser(db, u, (tx) => insertRow(tx, outsideRow(u)))).rejects.toThrow();
    expect(await outsideCount(u)).toBe(5);
  });
});
