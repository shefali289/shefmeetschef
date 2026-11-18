import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/*
 * Contract: /admin/challenges (src/app/admin/challenges/page.tsx), under the admin layout.
 * - adminGate() on the server; anything but "admin" renders nothing (the layout explains).
 * - Reads with the admin's own client (gate.supabase): recipes for the form and every challenge.
 * - Renders <ChallengeForm> with the live Shef recipes (createChallenge action) and dates
 *   defaulting to Monday to Sunday NZ, and lists challenges newest first, each linking to
 *   /challenges/<id> with its dates.
 */

vi.mock("server-only", () => ({}));
type Row = Record<string, unknown>;
const { state } = vi.hoisted(() => ({
  state: {
    gate: "admin" as "admin" | "not-admin" | "signed-out" | "not-configured",
    tables: [] as string[],
    data: {} as Record<string, Row[]>,
  },
}));

function fakeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    from: vi.fn((table: string) => {
      state.tables.push(table);
      const preds: [string, unknown][] = [];
      const run = () => (state.data[table] ?? []).filter((r) => preds.every(([c, v]) => r[c] === v));
      const b: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "neq", "in", "is", "lt", "lte", "gt", "gte", "not", "filter", "returns"]) b[m] = () => b;
      b.eq = (c: string, v: unknown) => {
        preds.push([c, v]);
        return b;
      };
      b.maybeSingle = async () => ({ data: run()[0] ?? null, error: null });
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res, rej);
      return b;
    }),
    rpc: vi.fn(async () => ({ data: null, error: { message: "no rpc" } })),
  };
}

const client = fakeClient();
vi.mock("@/lib/auth/session", () => ({
  adminGate: vi.fn(async () =>
    state.gate === "admin"
      ? { state: "admin", user: { id: "a1", email: "shef@example.com" }, supabase: client }
      : state.gate === "not-admin"
        ? { state: "not-admin", user: { id: "u1" } }
        : { state: state.gate },
  ),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => client) }));
vi.mock("./actions", () => ({ createChallenge: vi.fn(async () => null), pickWinner: vi.fn(async () => null) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (u: string) => {
    throw new Error(`NEXT_REDIRECT ${u}`);
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/challenges",
  useSearchParams: () => new URLSearchParams(),
}));

import AdminChallengesPage from "./page";

const render$ = async () => {
  const ui = await (AdminChallengesPage as unknown as (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement | null>)({
    searchParams: Promise.resolve({}),
  });
  return render(<>{ui}</>);
};

beforeEach(() => {
  state.gate = "admin";
  state.tables = [];
  state.data = {
    recipes: [
      { id: "11111111-1111-4111-8111-111111111111", title: "Masala Chai", slug: "masala-chai", source: "shef", status: "live" },
      { id: "33333333-3333-4333-8333-333333333333", title: "Secret Curry", slug: "secret-curry", source: "shef", status: "draft" },
      { id: "44444444-4444-4444-8444-444444444444", title: "Nani's Dal", slug: "reel-nani-abc", source: "outside", status: "live" },
    ],
    challenges: [
      {
        id: "c2c2c2c2-0000-4000-8000-000000000002",
        title: "Chai, your way",
        description: null,
        base_recipe_id: "11111111-1111-4111-8111-111111111111",
        starts_on: "2026-11-16",
        ends_on: "2026-11-22",
        winner_remix_id: null,
      },
    ],
  };
});

describe("/admin/challenges", () => {
  it("shows the form with live Shef recipes and lists challenges with links", async () => {
    await render$();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/challenges/i);
    const select = screen.getByLabelText(/base recipe/i) as HTMLSelectElement;
    const options = Array.from(select.options).filter((o) => o.value !== "").map((o) => o.textContent);
    expect(options).toEqual(["Masala Chai"]);
    expect(screen.getByRole("button", { name: /create challenge/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /chai, your way/i })).toHaveAttribute(
      "href",
      "/challenges/c2c2c2c2-0000-4000-8000-000000000002",
    );
    expect(state.tables).toEqual(expect.arrayContaining(["recipes", "challenges"]));
  });

  it("renders nothing for non-admins (the layout explains)", async () => {
    for (const gate of ["not-admin", "signed-out", "not-configured"] as const) {
      state.gate = gate;
      state.tables = [];
      const { container, unmount } = await render$();
      expect(container.textContent).toBe("");
      expect(state.tables).toEqual([]);
      unmount();
    }
  });
});
