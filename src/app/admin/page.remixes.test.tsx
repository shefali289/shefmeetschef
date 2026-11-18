import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/*
 * Contract (task 3 slice D, open question 12): the admin home links to /admin/remixes ("Remixes
 * to check", 44px target) and shows how many remixes are waiting, counted on the server with the
 * admin's own client by countWaitingRemixes(gate.supabase) from @/lib/moderation/queue:
 * "3 waiting" (or "1 waiting"); nothing extra when none are waiting. No alert, just the count.
 * Slice D review B3: countWaitingRemixes gives null when the count could not be loaded; the link
 * then shows no count at all (never "0 waiting").
 */

vi.mock("server-only", () => ({}));
const client = {
  from: vi.fn(() => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "returns", "in", "is", "or", "neq"]) b[m] = () => b;
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
    return b;
  }),
};
vi.mock("@/lib/auth/session", () => ({
  adminGate: vi.fn(async () => ({ state: "admin", user: { id: "a1", email: "shef@example.com" }, supabase: client })),
}));
const { countWaitingRemixes } = vi.hoisted(() => ({ countWaitingRemixes: vi.fn(async (_c: unknown): Promise<number | null> => 3) }));
vi.mock("@/lib/moderation/queue", () => ({
  countWaitingRemixes,
  loadModerationQueue: vi.fn(async () => ({ items: [], failed: false })),
  loadBannedUsers: vi.fn(async () => []),
}));
vi.mock("./actions", () => ({ importNow: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));

import AdminPage from "./page";

const TARGET_44 = /(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/;

beforeEach(() => countWaitingRemixes.mockClear());

describe("admin home: remixes waiting", () => {
  it("links to /admin/remixes with the count of remixes waiting", async () => {
    render(await AdminPage({ searchParams: Promise.resolve({}) }));
    const link = screen.getByRole("link", { name: /remixes to check/i });
    expect(link).toHaveAttribute("href", "/admin/remixes");
    expect(link.className).toMatch(TARGET_44);
    expect(link).toHaveTextContent(/3 waiting/i);
    expect(countWaitingRemixes).toHaveBeenCalledWith(client);
  });

  it("shows no count when nothing is waiting", async () => {
    countWaitingRemixes.mockImplementationOnce(async () => 0);
    render(await AdminPage({ searchParams: Promise.resolve({}) }));
    const link = screen.getByRole("link", { name: /remixes to check/i });
    expect(link).not.toHaveTextContent(/\d+ waiting/i);
  });

  it("B3: a count that could not be loaded shows no number, never 0", async () => {
    countWaitingRemixes.mockImplementationOnce(async () => null);
    render(await AdminPage({ searchParams: Promise.resolve({}) }));
    const link = screen.getByRole("link", { name: /remixes to check/i });
    expect(link).toHaveAttribute("href", "/admin/remixes");
    expect(link).not.toHaveTextContent(/\d/);
    expect(document.body.textContent).not.toMatch(/0 waiting|null|NaN|undefined/i);
  });
});
