import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const ROOT = resolve(__dirname, "../../..");
export const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");
const STUB = join(__dirname, "auth-stub.sql");

export type Tx = Transaction;
type Fn<T> = (tx: Tx) => Promise<T>;

/** Sorted list of migration file names in supabase/migrations. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Fresh in-memory Postgres with the auth/storage stub and every migration applied, in order.
 * `until` stops before the first migration whose file name sorts at or after it (a full file name
 * or a timestamp prefix such as "20261118000004"). `beforeMigrations` runs (as superuser) after the stub and before the first migration, to model
 * state that already exists on a real project.
 */
export async function createDb(
  opts: { beforeMigrations?: string; until?: string } = {},
): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(STUB, "utf8"));
  if (opts.beforeMigrations) await db.exec(opts.beforeMigrations);
  const until = opts.until;
  await applyMigrations(db, until ? migrationFiles().filter((f) => f < until) : migrationFiles());
  return db;
}

/**
 * Applies, in order, every migration whose file name sorts at or after `from` (a full file name or
 * just its timestamp prefix). Pair with `createDb({ until: from })` to seed data that existed
 * before a migration and then run it.
 */
export async function applyMigrationsFrom(db: PGlite, from: string): Promise<void> {
  await applyMigrations(db, migrationFiles().filter((f) => f >= from));
}

async function applyMigrations(db: PGlite, files: string[]): Promise<void> {
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (e) {
      throw new Error(`migration ${file} failed: ${(e as Error).message}`);
    }
  }
}

/**
 * Runs fn inside a transaction as the given role and jwt subject. The transaction commits when fn
 * resolves. If a statement fails, Postgres aborts the transaction, so a test that expects an
 * error must let it escape: `await expect(asUser(db, id, (tx) => tx.query(...))).rejects.toThrow()`.
 */
async function asRole<T>(db: PGlite, role: string, uid: string | null, fn: Fn<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`set local role ${role}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ""]);
    return fn(tx);
  });
}

export const asAnon = <T>(db: PGlite, fn: Fn<T>) => asRole(db, "anon", null, fn);
export const asUser = <T>(db: PGlite, uid: string, fn: Fn<T>) =>
  asRole(db, "authenticated", uid, fn);
/** Admin is a normal signed-in user whose profile has is_admin = true (see makeAdmin). */
export const asAdmin = <T>(db: PGlite, adminId: string, fn: Fn<T>) =>
  asRole(db, "authenticated", adminId, fn);

/** Inserts into auth.users as superuser (fires the sign-up trigger). Returns the id. */
export async function createUser(
  db: PGlite,
  user: { id?: string; email?: string; meta?: Record<string, unknown> } = {},
): Promise<string> {
  const id = user.id ?? randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    user.email ?? `${id}@example.com`,
    JSON.stringify(user.meta ?? {}),
  ]);
  return id;
}

/** Sets profiles.is_admin = true as superuser. */
export async function makeAdmin(db: PGlite, id: string): Promise<void> {
  const res = await db.query(`update public.profiles set is_admin = true where id = $1`, [id]);
  if (res.affectedRows !== 1) throw new Error(`makeAdmin: no profile for ${id}`);
}

export type RecipeSeed = {
  slug?: string;
  title?: string;
  source?: "shef" | "outside";
  status?: "draft" | "live";
  owner_id?: string | null;
  /**
   * When the row was created (default now()). Superuser-seeded outside rows from this NZ month count
   * toward the owner's outside_reel allowance (migration 000005), so seed fixtures in an earlier
   * month when the test later inserts outside recipes as that owner.
   */
  created_at?: string;
};

/**
 * Inserts a recipe as superuser (seeding, like the importer or a migration; not limited by the
 * outside_reel usage check, which applies to API roles). Returns { id, slug }.
 */
export async function insertRecipe(db: PGlite, r: RecipeSeed = {}) {
  // outside recipe slugs must start with "reel-" and shef slugs must not (migration 000005)
  const slug = r.slug ?? `${r.source === "outside" ? "reel" : "recipe"}-${randomUUID().slice(0, 8)}`;
  const status = r.status ?? "live";
  const res = await db.query<{ id: string; slug: string }>(
    `insert into public.recipes (slug, title, source, status, owner_id, published_at, created_at)
     values ($1, $2, $3::recipe_source, $4::recipe_status, $5, $6, coalesce($7::timestamptz, now()))
     returning id, slug`,
    [
      slug,
      r.title ?? slug,
      r.source ?? "shef",
      status,
      r.owner_id ?? null,
      status === "live" ? new Date().toISOString() : null,
      r.created_at ?? null,
    ],
  );
  return res.rows[0];
}

/** Runs a query as superuser (outside any role), for seeding and re-reading. */
export async function asSuper<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

const PERMISSION_DENIED = "42501";
function isPgError(e: unknown, code: string) {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === code;
}

/**
 * A blocked UPDATE/DELETE: either RLS filters every row (0 rows affected) or the role has no
 * privilege at all (permission denied). Anything else fails the test. Callers then re-read the
 * row as superuser to prove nothing changed.
 */
export async function expectBlockedWrite(run: () => Promise<{ affectedRows?: number }>) {
  try {
    const res = await run();
    if ((res.affectedRows ?? 0) !== 0) {
      throw new Error(`expected write to be blocked, but ${res.affectedRows} row(s) changed`);
    }
  } catch (e) {
    if (!isPgError(e, PERMISSION_DENIED)) throw e;
  }
}

/**
 * Rows a role can see. Permission denied counts as seeing nothing (e.g. anon with no grant).
 */
export async function visibleRows<T>(run: () => Promise<{ rows: T[] }>): Promise<T[]> {
  try {
    return (await run()).rows;
  } catch (e) {
    if (isPgError(e, PERMISSION_DENIED)) return [];
    throw e;
  }
}

/**
 * Runs a statement that must fail and returns the Postgres error (code and message), so tests can
 * check *why* it failed. Fails the test if the statement succeeds or throws a non-Postgres error.
 */
export async function pgErrorOf(run: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await run();
  } catch (e) {
    if (typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string") {
      return { code: (e as { code: string }).code, message: (e as Error).message };
    }
    throw e;
  }
  throw new Error("expected the statement to fail, but it succeeded");
}

export type RemixStatus = "pending" | "approved" | "hidden";

export type RemixSeed = {
  recipe_id: string;
  user_id: string;
  status?: RemixStatus;
  /** Defaults to a fresh `<uid>/<uuid>.jpg`. */
  photo_path?: string;
  changes?: string;
  challenge_id?: string | null;
  created_at?: string;
  /** Also create the remix-photos object named photo_path (default true). */
  withPhoto?: boolean;
};

/**
 * Inserts a remix as superuser (seeding, like moderation would leave it; the task 3 insert trigger
 * only applies to anon and authenticated). By default it also creates the photo object in
 * remix-photos. Returns { id, photo_path }.
 */
export async function seedRemix(db: PGlite, r: RemixSeed) {
  const photo = r.photo_path ?? `${r.user_id}/${randomUUID()}.jpg`;
  if (r.withPhoto ?? true) {
    await db.query(`insert into storage.objects (bucket_id, name, owner) values ('remix-photos', $1, $2)`, [photo, r.user_id]);
  }
  const res = await db.query<{ id: string; photo_path: string }>(
    `insert into public.remixes (recipe_id, user_id, photo_path, changes, status, challenge_id, created_at)
     values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()))
     returning id, photo_path`,
    [r.recipe_id, r.user_id, photo, r.changes ?? "less salt", r.status ?? "pending", r.challenge_id ?? null, r.created_at ?? null],
  );
  return res.rows[0];
}

/**
 * Uploads an object as the signed-in user, through storage RLS, like the browser does with the
 * user's session (the Storage API sets owner to the caller). Defaults to a fresh
 * `remix-photos/<uid>/<uuid>.jpg`. Returns the object name.
 */
export async function uploadObject(
  db: PGlite,
  uid: string,
  opts: { bucket?: string; name?: string } = {},
): Promise<string> {
  const name = opts.name ?? `${uid}/${randomUUID()}.jpg`;
  await asUser(db, uid, (tx) =>
    tx.query(`insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)`, [opts.bucket ?? "remix-photos", name, uid]),
  );
  return name;
}

/** Records a ban as superuser (task 3 slice D adds the admin function). */
export async function banUser(db: PGlite, uid: string, opts: { reason?: string; by?: string | null } = {}) {
  await db.query(`insert into public.bans (user_id, reason, banned_by) values ($1, $2, $3)`, [
    uid,
    opts.reason ?? "spam",
    opts.by ?? null,
  ]);
}

export { randomUUID as uuid };
