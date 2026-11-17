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
  };
}

export function makeFakeClient(db: FakeDb, kind: "anon" | "session") {
  const viewerId = () => (kind === "session" ? (db.user?.id ?? null) : null);
  const from = vi.fn((table: string) => {
    const filters: [string, unknown][] = [];
    let write: FakeDb["writes"][number] | null = null;
    let writeError: { message: string; code?: string } | null = null;
    const visible = () => {
      if (table !== "recipes") return [];
      const v = viewerId();
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
  return {
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
