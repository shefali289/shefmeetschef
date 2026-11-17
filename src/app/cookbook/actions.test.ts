import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
 * Contract (src/app/cookbook/actions.ts, "use server"). Every action is a useActionState action:
 *   action(prev: CookbookActionState, formData) -> Promise<{ ok?, saved?, error? }>
 * - Uses the signed-in user's Supabase client from createSupabaseServerClient (RLS applies; no
 *   service role key).
 * - Not configured (client is null): returns { error } mentioning "not set up yet". No redirect.
 * - Signed out: redirect("/sign-in?next=<encoded path>"). toggleSave returns to the safe
 *   `return_to` path (default /cookbook), the folder actions return to /cookbook.
 * - Inputs are zod-validated: ids are uuids; folder names are trimmed, 1 to 80 chars. Bad input
 *   returns { error } and touches no table.
 * - Success calls revalidatePath("/cookbook").
 * Form fields:
 *   toggleSave:   recipe_id, intent ("save" | "unsave"), return_to (optional path)
 *   createFolder: name
 *   renameFolder: folder_id, name
 *   deleteFolder: folder_id
 *   moveSave:     save_id, folder_id ("" means unfiled)
 *   removeSave:   save_id (removes a save, e.g. one whose recipe is no longer available)
 * The saves limit trigger raises an error whose message contains "saves_limit_reached".
 * renameFolder, deleteFolder, moveSave and removeSave chain .select("id") after the write and return
 * an error ("We couldn't find that folder" / "...that save") when it touched 0 rows (review N4).
 */

type Op = {
  table: string;
  method: "select" | "insert" | "update" | "delete" | "upsert";
  payload?: unknown;
  filters: [string, string, unknown][];
  /** Columns asked back with .select() after a write (e.g. "id"). */
  returning?: string;
};
type DbError = { code?: string; message: string } | null;

const state: {
  ops: Op[];
  user: { id: string; email: string } | null;
  configured: boolean;
  errorFor: (op: Op) => DbError;
  /** Rows a write affected (returned when the write chains .select()). Default: one row. */
  rowsFor: (op: Op) => unknown[];
} = { ops: [], user: null, configured: true, errorFor: () => null, rowsFor: () => [{ id: "x" }] };

function makeClient() {
  const from = (table: string) => {
    const op: Op = { table, method: "select", filters: [] };
    state.ops.push(op);
    const result = () => {
      const error = state.errorFor(op);
      if (error) return { data: null, error };
      if (op.method === "select") return { data: [], error: null };
      // like PostgREST: a write returns rows only when .select() is chained
      return { data: op.returning !== undefined ? state.rowsFor(op) : null, error: null };
    };
    const b: Record<string, unknown> = {};
    for (const m of ["insert", "update", "delete", "upsert"] as const) {
      b[m] = (payload?: unknown) => {
        op.method = m;
        op.payload = payload;
        return b;
      };
    }
    b.select = (cols?: string) => {
      if (op.method !== "select") op.returning = cols ?? "*";
      return b;
    };
    for (const f of ["eq", "neq", "is", "in", "match", "filter", "order", "limit", "not"]) {
      b[f] = (col: string, val?: unknown) => {
        op.filters.push([f, col, val]);
        return b;
      };
    }
    b.single = async () => result();
    b.maybeSingle = async () => result();
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    return b;
  };
  return {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: vi.fn(from),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
}

const { createSupabaseServerClient } = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  }),
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  }),
}));

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as actions from "./actions";

type State = { ok?: boolean; saved?: boolean; error?: string };
type Action = (prev: State, fd: FormData) => Promise<State>;
const toggleSave = actions.toggleSave as Action;
const createFolder = actions.createFolder as Action;
const renameFolder = actions.renameFolder as Action;
const deleteFolder = actions.deleteFolder as Action;
const moveSave = actions.moveSave as Action;
const removeSave = (actions as unknown as { removeSave: Action }).removeSave;

const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const RECIPE = "11111111-1111-4111-8111-111111111111";
const FOLDER = "f0000000-0000-4000-8000-000000000001";
const SAVE = "50000000-0000-4000-8000-000000000001";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function writes(table?: string) {
  return state.ops.filter((o) => o.method !== "select" && (!table || o.table === table));
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  const err = (await p.then(
    () => {
      throw new Error("expected a redirect");
    },
    (e: unknown) => e,
  )) as { digest?: string };
  expect(err.digest).toMatch(/^NEXT_REDIRECT;/);
  return err.digest!.slice("NEXT_REDIRECT;".length);
}

beforeEach(() => {
  state.ops = [];
  state.user = USER;
  state.configured = true;
  state.errorFor = () => null;
  state.rowsFor = () => [{ id: "x" }];
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(redirect).mockClear();
  createSupabaseServerClient.mockReset();
  createSupabaseServerClient.mockImplementation(async () => (state.configured ? makeClient() : null));
});

describe("toggleSave", () => {
  it("toggleSave saves and unsaves with the user's client", async () => {
    const saved = await toggleSave({}, form({ recipe_id: RECIPE, intent: "save" }));
    expect(saved).toMatchObject({ saved: true });
    expect(saved.error).toBeUndefined();
    const [insert] = writes("saves");
    expect(insert.method).toMatch(/insert|upsert/);
    expect(insert.payload).toMatchObject({ recipe_id: RECIPE });
    // New saves start unfiled.
    expect((insert.payload as Record<string, unknown>).folder_id ?? null).toBeNull();
    expect(createSupabaseServerClient).toHaveBeenCalled();

    state.ops = [];
    const unsaved = await toggleSave({}, form({ recipe_id: RECIPE, intent: "unsave" }));
    expect(unsaved).toMatchObject({ saved: false });
    const [del] = writes("saves");
    expect(del.method).toBe("delete");
    expect(del.filters).toContainEqual(["eq", "recipe_id", RECIPE]);
  });

  it("saving an already saved recipe is not an error", async () => {
    state.errorFor = (op) =>
      op.table === "saves" && op.method !== "select"
        ? { code: "23505", message: 'duplicate key value violates unique constraint "saves_user_recipe_key"' }
        : null;
    const res = await toggleSave({}, form({ recipe_id: RECIPE, intent: "save" }));
    expect(res).toMatchObject({ saved: true });
    expect(res.error).toBeUndefined();
  });

  it("saves_limit_reached returns You've used 30 of 30 saves", async () => {
    state.errorFor = (op) =>
      op.table === "saves" && op.method !== "select" ? { code: "P0001", message: "saves_limit_reached" } : null;
    const res = await toggleSave({}, form({ recipe_id: RECIPE, intent: "save" }));
    expect(res.error).toMatch(/You[’']ve used 30 of 30 saves/);
    expect(res.saved).not.toBe(true);
  });

  it("other database errors return a friendly message, not the raw error", async () => {
    state.errorFor = (op) =>
      op.table === "saves" && op.method !== "select" ? { code: "42501", message: "permission denied for table saves" } : null;
    const res = await toggleSave({}, form({ recipe_id: RECIPE, intent: "save" }));
    expect(res.error).toBeTruthy();
    expect(res.error).not.toMatch(/permission denied/);
  });

  it("rejects a non-uuid recipe id or unknown intent without touching the database", async () => {
    for (const fields of [
      { recipe_id: "not-a-uuid", intent: "save" },
      { recipe_id: "", intent: "save" },
      { recipe_id: "1; drop table saves", intent: "unsave" },
      { recipe_id: RECIPE, intent: "explode" },
      { intent: "save" },
    ]) {
      const res = await toggleSave({}, form(fields as Record<string, string>));
      expect(res.error, JSON.stringify(fields)).toBeTruthy();
    }
    expect(writes()).toEqual([]);
  });

  it("never lets the client choose the user or the folder on save", async () => {
    await toggleSave(
      {},
      form({ recipe_id: RECIPE, intent: "save", user_id: "c0000000-0000-4000-8000-000000000009", folder_id: FOLDER }),
    );
    const [insert] = writes("saves");
    const payload = insert.payload as Record<string, unknown>;
    expect(payload.user_id === undefined || payload.user_id === USER.id).toBe(true);
    expect(payload.folder_id ?? null).toBeNull();
  });
});

describe("folders", () => {
  it("createFolder rejects blank and over-80 names", async () => {
    for (const name of ["", "   ", "\n\t", "a".repeat(81), ` ${"b".repeat(81)} `]) {
      const res = await createFolder({}, form({ name }));
      expect(res.error, JSON.stringify(name)).toBeTruthy();
    }
    expect(writes()).toEqual([]);

    const ok = await createFolder({}, form({ name: `  ${"c".repeat(80)}  ` }));
    expect(ok.error).toBeUndefined();
    const [insert] = writes("folders");
    expect(insert.method).toBe("insert");
    expect(insert.payload).toMatchObject({ name: "c".repeat(80) });
  });

  it("createFolder trims the name and ignores a client-supplied user_id", async () => {
    await createFolder({}, form({ name: "  Desserts  ", user_id: "c0000000-0000-4000-8000-000000000009" }));
    const [insert] = writes("folders");
    const payload = insert.payload as Record<string, unknown>;
    expect(payload.name).toBe("Desserts");
    expect(payload.user_id === undefined || payload.user_id === USER.id).toBe(true);
  });

  it("renameFolder and deleteFolder act on the id given and rely on RLS for ownership", async () => {
    const renamed = await renameFolder({}, form({ folder_id: FOLDER, name: "  Sweet things " }));
    expect(renamed.error).toBeUndefined();
    let folderWrites = writes("folders");
    expect(folderWrites).toHaveLength(1);
    expect(folderWrites[0]).toMatchObject({ method: "update", payload: { name: "Sweet things" } });
    expect(folderWrites[0].filters).toContainEqual(["eq", "id", FOLDER]);

    state.ops = [];
    const deleted = await deleteFolder({}, form({ folder_id: FOLDER }));
    expect(deleted.error).toBeUndefined();
    folderWrites = writes("folders");
    expect(folderWrites).toHaveLength(1);
    expect(folderWrites[0].method).toBe("delete");
    expect(folderWrites[0].filters).toContainEqual(["eq", "id", FOLDER]);
    // Deleting a folder keeps its saves (the FK sets folder_id to null).
    expect(writes("saves")).toEqual([]);
    // No service-role or admin path: the user's own client did it.
    expect(createSupabaseServerClient).toHaveBeenCalled();
  });

  it("renameFolder validates the id and the name", async () => {
    for (const fields of [
      { folder_id: "nope", name: "Desserts" },
      { folder_id: FOLDER, name: "  " },
      { folder_id: FOLDER, name: "x".repeat(81) },
    ]) {
      const res = await renameFolder({}, form(fields));
      expect(res.error, JSON.stringify(fields)).toBeTruthy();
    }
    const res = await deleteFolder({}, form({ folder_id: "../../etc" }));
    expect(res.error).toBeTruthy();
    expect(writes()).toEqual([]);
  });
});

describe("moveSave", () => {
  it("moveSave sets or clears folder_id", async () => {
    const moved = await moveSave({}, form({ save_id: SAVE, folder_id: FOLDER }));
    expect(moved.error).toBeUndefined();
    let [update] = writes("saves");
    expect(update).toMatchObject({ method: "update", payload: { folder_id: FOLDER } });
    expect(update.filters).toContainEqual(["eq", "id", SAVE]);

    state.ops = [];
    const cleared = await moveSave({}, form({ save_id: SAVE, folder_id: "" }));
    expect(cleared.error).toBeUndefined();
    [update] = writes("saves");
    expect(update).toMatchObject({ method: "update", payload: { folder_id: null } });
    expect(update.filters).toContainEqual(["eq", "id", SAVE]);
  });

  it("moveSave rejects bad ids and only ever updates folder_id", async () => {
    for (const fields of [
      { save_id: "nope", folder_id: FOLDER },
      { save_id: SAVE, folder_id: "not-a-uuid" },
    ]) {
      const res = await moveSave({}, form(fields));
      expect(res.error, JSON.stringify(fields)).toBeTruthy();
    }
    expect(writes()).toEqual([]);

    await moveSave({}, form({ save_id: SAVE, folder_id: FOLDER, user_id: USER.id, recipe_id: RECIPE }));
    const [update] = writes("saves");
    expect(Object.keys(update.payload as object)).toEqual(["folder_id"]);
  });

  it("moving into someone else's folder (RLS rejects it) returns an error", async () => {
    state.errorFor = (op) =>
      op.table === "saves" && op.method === "update"
        ? { code: "42501", message: 'new row violates row-level security policy for table "saves"' }
        : null;
    const res = await moveSave({}, form({ save_id: SAVE, folder_id: FOLDER }));
    expect(res.error).toBeTruthy();
    expect(res.error).not.toMatch(/row-level security/);
  });
});

describe("zero rows touched (review N4)", () => {
  const noRows = () => {
    state.rowsFor = () => [];
  };

  it("renameFolder returns an error when no folder was updated", async () => {
    noRows();
    const res = await renameFolder({}, form({ folder_id: FOLDER, name: "Puddings" }));
    expect(res.error).toMatch(/couldn[’']t find that folder/i);
    expect(res.ok).not.toBe(true);
    const [update] = writes("folders");
    expect(update.returning).toMatch(/id/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("deleteFolder returns an error when no folder was deleted", async () => {
    noRows();
    const res = await deleteFolder({}, form({ folder_id: FOLDER }));
    expect(res.error).toMatch(/couldn[’']t find that folder/i);
    const [del] = writes("folders");
    expect(del.returning).toMatch(/id/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("moveSave returns an error when no save was updated", async () => {
    noRows();
    const res = await moveSave({}, form({ save_id: SAVE, folder_id: FOLDER }));
    expect(res.error).toMatch(/couldn[’']t find that save/i);
    const [update] = writes("saves");
    expect(update.returning).toMatch(/id/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("one row touched is success", async () => {
    for (const [name, action, fields] of [
      ["renameFolder", renameFolder, { folder_id: FOLDER, name: "Puddings" }],
      ["deleteFolder", deleteFolder, { folder_id: FOLDER }],
      ["moveSave", moveSave, { save_id: SAVE, folder_id: "" }],
    ] as const) {
      state.ops = [];
      const res = await action({}, form(fields));
      expect(res.error, name).toBeUndefined();
      expect(writes()[0].returning, name).toMatch(/id/);
    }
  });
});

describe("removeSave (review B1)", () => {
  it("deletes the save by id with the user's session client", async () => {
    expect(typeof removeSave).toBe("function");
    const res = await removeSave({}, form({ save_id: SAVE }));
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    const all = writes();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ table: "saves", method: "delete" });
    expect(all[0].filters).toContainEqual(["eq", "id", SAVE]);
    expect(all[0].returning).toMatch(/id/);
    expect(createSupabaseServerClient).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/cookbook");
  });

  it("returns an error when no save was deleted", async () => {
    state.rowsFor = () => [];
    const res = await removeSave({}, form({ save_id: SAVE }));
    expect(res.error).toMatch(/couldn[’']t find that save/i);
    expect(res.ok).not.toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("database errors return a friendly message", async () => {
    state.errorFor = (op) => (op.method === "delete" ? { code: "42501", message: "permission denied for table saves" } : null);
    const res = await removeSave({}, form({ save_id: SAVE }));
    expect(res.error).toBeTruthy();
    expect(res.error).not.toMatch(/permission denied/);
  });

  it("rejects a bad uuid without touching the database", async () => {
    for (const save_id of ["", "nope", "1; delete from saves", `${SAVE}x`]) {
      const res = await removeSave({}, form({ save_id }));
      expect(res.error, save_id).toBeTruthy();
    }
    const missing = await removeSave({}, new FormData());
    expect(missing.error).toBeTruthy();
    expect(writes()).toEqual([]);
  });

  it("only uses save_id from the form", async () => {
    await removeSave({}, form({ save_id: SAVE, user_id: "c0000000-0000-4000-8000-000000000009", recipe_id: RECIPE }));
    const [del] = writes("saves");
    expect(del.filters.filter(([, col]) => col === "user_id").every(([, , v]) => v === USER.id)).toBe(true);
    expect(del.filters.some(([, col]) => col === "recipe_id")).toBe(false);
  });

  it("signed out redirects to sign-in", async () => {
    state.user = null;
    const to = await redirectOf(removeSave({}, form({ save_id: SAVE })));
    expect(to).toBe(`/sign-in?next=${encodeURIComponent("/cookbook")}`);
    expect(writes()).toEqual([]);
  });

  it("not configured returns not set up yet", async () => {
    state.configured = false;
    const res = await removeSave({}, form({ save_id: SAVE }));
    expect(res.error).toMatch(/not set up yet/i);
    expect(redirect).not.toHaveBeenCalled();
  });
});

const everyAction: [string, Action, Record<string, string>][] = [
  ["toggleSave", toggleSave, { recipe_id: RECIPE, intent: "save" }],
  ["createFolder", createFolder, { name: "Desserts" }],
  ["renameFolder", renameFolder, { folder_id: FOLDER, name: "Puddings" }],
  ["deleteFolder", deleteFolder, { folder_id: FOLDER }],
  ["moveSave", moveSave, { save_id: SAVE, folder_id: FOLDER }],
];

describe("auth and setup", () => {
  it("every action redirects signed-out users to sign-in", async () => {
    state.user = null;
    for (const [name, action, fields] of everyAction) {
      const to = await redirectOf(action({}, form(fields)));
      expect(to, name).toBe(`/sign-in?next=${encodeURIComponent("/cookbook")}`);
    }
    expect(writes()).toEqual([]);

    // The heart sends people back to the recipe they were on.
    const back = await redirectOf(
      toggleSave({}, form({ recipe_id: RECIPE, intent: "save", return_to: "/recipes/paneer-tikka" })),
    );
    expect(back).toBe(`/sign-in?next=${encodeURIComponent("/recipes/paneer-tikka")}`);

    // But never to another site.
    for (const evil of ["https://evil.example/x", "//evil.example", "/\\evil.example"]) {
      const to = await redirectOf(toggleSave({}, form({ recipe_id: RECIPE, intent: "save", return_to: evil })));
      expect(to).toMatch(/^\/sign-in\?next=%2F/);
      expect(decodeURIComponent(to)).not.toContain("evil.example");
    }
  });

  it("not configured returns not set up yet", async () => {
    state.configured = false;
    for (const [name, action, fields] of everyAction) {
      const res = await action({}, form(fields));
      expect(res.error, name).toMatch(/not set up yet/i);
    }
    expect(redirect).not.toHaveBeenCalled();
  });

  it("actions revalidate /cookbook", async () => {
    for (const [name, action, fields] of everyAction) {
      vi.mocked(revalidatePath).mockClear();
      const res = await action({}, form(fields));
      expect(res.error, name).toBeUndefined();
      expect(revalidatePath, name).toHaveBeenCalledWith("/cookbook");
    }
  });

  it("failed validation does not revalidate", async () => {
    await createFolder({}, form({ name: "" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
