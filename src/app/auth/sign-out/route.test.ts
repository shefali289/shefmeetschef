// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const signOut = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { signOut } })),
}));

import * as route from "./route";

const ORIGIN = "http://localhost:3000";
const post = (headers: Record<string, string>) =>
  new NextRequest(`${ORIGIN}/auth/sign-out`, { method: "POST", headers });

beforeEach(() => signOut.mockClear());

describe("/auth/sign-out", () => {
  it("has no GET export (a link or image cannot sign people out)", () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });

  it("POST with mismatched Origin header -> 403 and no sign-out", async () => {
    for (const origin of ["https://evil.example", "http://localhost:3000.evil.example", "null"]) {
      const res = await route.POST(post({ origin }));
      expect(res.status, origin).toBe(403);
    }
    expect(signOut).not.toHaveBeenCalled();
  });

  it("same origin -> signs out and 303 to /", async () => {
    const res = await route.POST(post({ origin: ORIGIN }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!, ORIGIN);
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname).toBe("/");
  });
});
