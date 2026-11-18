import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

/*
 * Contract: HeaderAuth (async server component, no props) reads the session through
 * createSupabaseServerClient. Signed in: a "Cookbook" link to /cookbook (44px target) plus Sign out.
 * Signed out: Sign in only. Not configured: nothing.
 */

const { createSupabaseServerClient } = vi.hoisted(() => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));

import HeaderAuth from "./HeaderAuth";

function clientFor(user: { id: string; email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: null, error: null });
      return b;
    },
  };
}

async function renderHeader() {
  return render((await HeaderAuth()) as React.ReactElement);
}

beforeEach(() => createSupabaseServerClient.mockReset());

describe("HeaderAuth", () => {
  it("shows Cookbook link when signed in", async () => {
    createSupabaseServerClient.mockResolvedValue(
      clientFor({ id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" }),
    );
    await renderHeader();
    const link = screen.getByRole("link", { name: /cookbook/i });
    expect(link).toHaveAttribute("href", "/cookbook");
    expect(link.className).toMatch(/(^|\s)(min-h|h)-(1[1-9]|[2-9]\d)(\s|$)/);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("hides it when signed out or not configured", async () => {
    createSupabaseServerClient.mockResolvedValue(clientFor(null));
    const { unmount } = await renderHeader();
    expect(screen.queryByRole("link", { name: /cookbook/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
    unmount();

    createSupabaseServerClient.mockResolvedValue(null);
    const { container } = await renderHeader();
    expect(screen.queryByRole("link", { name: /cookbook/i })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
