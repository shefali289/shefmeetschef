// Test helper for Slice B action and page tests: a tiny Supabase client fake that applies the
// recipes RLS rules (anon: live shef; signed-in: also own outside recipes) and records writes/rpcs.
import { vi } from "vitest";

export type FakeRow = Record<string, unknown> & { slug: string; source: string; status: string };

export interface FakeDb {
  rows: FakeRow[];
  user: { id: string; email: string } | null;
  rpcs: { client: "anon" | "session"; fn: string; args: Record<string, unknown> | undefined }[];
  writes: {
    client: "anon" | "session";
    table: string;
    method: "insert" | "update" | "delete" | "upsert";
    payload: unknown;
  }[];
  rpcResult: Record<string, { data: unknown; error: { message: string; code?: string } | null }>;
  /** Errors returned for the next inserts into a table, in order. */
  insertErrors: Record<string, ({ message: string; code?: string } | null)[]>;
  sessionClients: number;
  /** Rows of `saves` ({ id, user_id, recipe_id, folder_id? }); a session sees only its own. */
  saves: Record<string, unknown>[];
  /** Every table read, with the eq filters applied, in order. */
  reads: { client: "anon" | "session"; table: string; filters: [string, unknown][] }[];
  /** Rows of `remixes` ({ id, user_id, recipe_id, status, ... }); a session sees only its own (RLS). */
  remixes: Record<string, unknown>[];
  /** Rows of `likes` ({ user_id, remix_id }); a session sees only its own (RLS). */
  likes: Record<string, unknown>[];
  /** Storage objects, keyed "<bucket>/<path>". */
  objects: Record<string, Uint8Array>;
  /** Object paths that Storage refuses to sign (e.g. not approved). */
  unsignable: string[];
  /** Every Storage call, in order. */
  storage: { client: "anon" | "session"; bucket: string; method: string; args: unknown[] }[];
}

export function newFakeDb(): FakeDb {
  return {
    rows: [],
    user: null,
    rpcs: [],
    writes: [],
    rpcResult: {},
    insertErrors: {},
    sessionClients: 0,
    saves: [],
    reads: [],
    remixes: [],
    likes: [],
    objects: {},
    unsignable: [],
    storage: [],
  };
}

/** The fake signed URL for an object, so tests can look for it in the page. */
export function fakeSignedUrl(bucket: string, path: string, expiresIn: number): string {
  return `https://signed.example/${bucket}/${path}?expires=${expiresIn}`;
}

export function makeFakeClient(db: FakeDb, kind: "anon" | "session") {
  const viewerId = () => (kind === "session" ? (db.user?.id ?? null) : null);
  const from = vi.fn((table: string) => {
    const filters: [string, unknown][] = [];
    let write: FakeDb["writes"][number] | null = null;
    let writeError: { message: string; code?: string } | null = null;
    const visible = () => {
      const v = viewerId();
      if (table === "remixes" || table === "likes") {
        return (table === "remixes" ? db.remixes : db.likes)
          .filter((r) => v !== null && r.user_id === v)
          .filter((r) => filters.every(([c, val]) => r[c] === val));
      }
      if (table === "saves") {
        return db.saves
          .filter((r) => v !== null && r.user_id === v)
          .filter((r) => filters.every(([c, val]) => r[c] === val));
      }
      if (table !== "recipes") return [];
      return db.rows
        .filter(
          (r) =>
            (r.status === "live" && r.source === "shef") ||
            (r.source === "outside" && v !== null && r.owner_id === v),
        )
        .filter((r) => filters.every(([c, val]) => r[c] === val));
    };
    const result = (single: boolean) => {
      if (write) {
        if (writeError) return { data: null, error: writeError };
        const payload = Array.isArray(write.payload) ? write.payload[0] : write.payload;
        const row = { id: `${table}-new-${db.writes.length}`, ...(payload as object) };
        return { data: single ? row : [row], error: null };
      }
      db.reads.push({ client: kind, table, filters: [...filters] });
      const rows = visible();
      if (single) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    };
    const b: Record<string, unknown> = {};
    for (const m of ["insert", "update", "delete", "upsert"] as const) {
      b[m] = vi.fn((payload?: unknown) => {
        write = { client: kind, table, method: m, payload };
        if (m === "insert") writeError = db.insertErrors[table]?.shift() ?? null;
        db.writes.push(write);
        return b;
      });
    }
    for (const m of ["select", "order", "limit", "range", "neq", "in", "is", "filter", "match", "not"]) {
      b[m] = vi.fn(() => b);
    }
    b.eq = vi.fn((c: string, val: unknown) => {
      filters.push([c, val]);
      return b;
    });
    b.maybeSingle = vi.fn(async () => result(true));
    b.single = vi.fn(async () => result(true));
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result(false)).then(res, rej);
    return b;
  });
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    db.rpcs.push({ client: kind, fn, args });
    return db.rpcResult[fn] ?? { data: null, error: { message: `no fake for ${fn}` } };
  });
  const storage = {
    from: vi.fn((bucket: string) => {
      const log = (method: string, args: unknown[]) => db.storage.push({ client: kind, bucket, method, args });
      const sign = (path: string, expiresIn: number) =>
        db.unsignable.includes(path)
          ? { path, signedUrl: null, error: "Object not found" }
          : { path, signedUrl: fakeSignedUrl(bucket, path, expiresIn), error: null };
      return {
        createSignedUrls: vi.fn(async (paths: string[], expiresIn: number) => {
          log("createSignedUrls", [paths, expiresIn]);
          return { data: paths.map((p) => sign(p, expiresIn)), error: null };
        }),
        createSignedUrl: vi.fn(async (path: string, expiresIn: number) => {
          log("createSignedUrl", [path, expiresIn]);
          const s = sign(path, expiresIn);
          return s.signedUrl
            ? { data: { signedUrl: s.signedUrl }, error: null }
            : { data: null, error: { message: "Object not found" } };
        }),
        download: vi.fn(async (path: string) => {
          log("download", [path]);
          const bytes = db.objects[`${bucket}/${path}`];
          return bytes
            ? { data: new Blob([bytes as BlobPart]), error: null }
            : { data: null, error: { message: "Object not found" } };
        }),
        remove: vi.fn(async (paths: string[]) => {
          log("remove", [paths]);
          for (const p of paths) delete db.objects[`${bucket}/${p}`];
          return { data: paths.map((name) => ({ name })), error: null };
        }),
        upload: vi.fn(async (path: string, body: unknown, options?: unknown) => {
          log("upload", [path, body, options]);
          return { data: { path }, error: null };
        }),
      };
    }),
  };
  return {
    storage,
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: kind === "session" ? db.user : null },
        error: null,
      })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    },
    from,
    rpc,
  };
}

/** Gemini generateContent response whose text is `output` as JSON. */
export function geminiJson(output: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(output) }] } }] }),
    { status, headers: { "content-type": "application/json" } },
  );
}
