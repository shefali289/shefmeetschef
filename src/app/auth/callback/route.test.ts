// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { exchangeCodeForSession } })),
}));

import { GET } from "./route";

const ORIGIN = "http://localhost:3000";
const req = (qs: string) => new NextRequest(`${ORIGIN}/auth/callback${qs}`);
const location = (res: Response) => new URL(res.headers.get("location")!, ORIGIN);

beforeEach(() => exchangeCodeForSession.mockReset());

describe("GET /auth/callback", () => {
  it("next=//evil.example redirects to /", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(req("?code=abc&next=//evil.example"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const loc = location(res);
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname).toBe("/");
  });

  it("successful exchange goes to a safe relative next", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(req(`?code=abc&next=${encodeURIComponent("/admin/recipes/1")}`));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    const loc = location(res);
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname).toBe("/admin/recipes/1");
  });

  it("failed exchange -> /sign-in?error=callback", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "bad code" } });
    const res = await GET(req("?code=bad&next=/admin"));
    const loc = location(res);
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname).toBe("/sign-in");
    expect(loc.searchParams.get("error")).toBe("callback");
  });

  it("missing code -> /sign-in?error=callback without calling Supabase", async () => {
    const res = await GET(req("?next=https://evil.example"));
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    const loc = location(res);
    expect(loc.pathname).toBe("/sign-in");
    expect(loc.searchParams.get("error")).toBe("callback");
    // a carried-over next is never off-site
    const next = loc.searchParams.get("next");
    if (next !== null) expect(next).toMatch(/^\/(?![/\\])/);
  });
});
