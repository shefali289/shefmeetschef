import { describe, expect, it } from "vitest";
import { adminSignInPath } from "./admin-sign-in";

describe("adminSignInPath", () => {
  it("keeps the requested admin path, encoded", () => {
    expect(adminSignInPath("/admin")).toBe("/sign-in?next=%2Fadmin");
    expect(adminSignInPath("/admin/recipes/11111111-1111-1111-1111-111111111111")).toBe(
      "/sign-in?next=%2Fadmin%2Frecipes%2F11111111-1111-1111-1111-111111111111",
    );
  });

  it("falls back to /admin for anything that is not an admin path", () => {
    for (const p of ["/", "/recipes", "/administrator", "//evil.example/admin", "https://evil.example/admin", "", "admin"]) {
      expect(adminSignInPath(p), p).toBe("/sign-in?next=%2Fadmin");
    }
  });

  it("result always round-trips through safeNext-style parsing to a relative /admin path", () => {
    const next = new URLSearchParams(adminSignInPath("/admin/recipes/x?y=1").split("?")[1]).get("next");
    expect(next).toMatch(/^\/admin(\/|$)/);
  });
});
