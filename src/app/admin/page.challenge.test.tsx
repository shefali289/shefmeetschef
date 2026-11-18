import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/* Contract (task 3 slice C): the admin home links to /admin/challenges (44px target). */

vi.mock("server-only", () => ({}));
const client = {
  from: vi.fn(() => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "returns"]) b[m] = () => b;
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
    return b;
  }),
};
vi.mock("@/lib/auth/session", () => ({
  adminGate: vi.fn(async () => ({ state: "admin", user: { id: "a1", email: "shef@example.com" }, supabase: client })),
}));
vi.mock("./actions", () => ({ importNow: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));

import AdminPage from "./page";

describe("admin home", () => {
  it("links to /admin/challenges", async () => {
    render(await AdminPage({ searchParams: Promise.resolve({}) }));
    const link = screen.getByRole("link", { name: /challenges/i });
    expect(link).toHaveAttribute("href", "/admin/challenges");
    expect(link.className).toMatch(/(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/);
  });
});
