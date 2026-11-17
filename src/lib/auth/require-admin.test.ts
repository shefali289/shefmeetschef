import { describe, expect, it, vi } from "vitest";
import { NotAdminError, NotSignedInError, requireAdmin } from "./require-admin";

const user = { id: "u1", email: "cook@example.com" };

describe("requireAdmin", () => {
  it("rejects anon", async () => {
    await expect(requireAdmin(async () => null)).rejects.toBeInstanceOf(NotSignedInError);
  });

  it("rejects non-admin user", async () => {
    await expect(
      requireAdmin(async () => ({ user, profile: { id: "u1", is_admin: false } })),
    ).rejects.toBeInstanceOf(NotAdminError);
    // signed in but no profile row: still not an admin
    await expect(requireAdmin(async () => ({ user, profile: null }))).rejects.toBeInstanceOf(
      NotAdminError,
    );
    // truthy-but-not-true is not admin (no loose checks)
    await expect(
      requireAdmin(async () => ({
        user,
        profile: { id: "u1", is_admin: "true" as unknown as boolean },
      })),
    ).rejects.toBeInstanceOf(NotAdminError);
  });

  it("rejects a profile that belongs to a different user", async () => {
    await expect(
      requireAdmin(async () => ({ user, profile: { id: "someone-else", is_admin: true } })),
    ).rejects.toBeInstanceOf(NotAdminError);
  });

  it("allows admin", async () => {
    const getter = vi.fn(async () => ({ user, profile: { id: "u1", is_admin: true } }));
    await expect(requireAdmin(getter)).resolves.toEqual({
      user,
      profile: { id: "u1", is_admin: true },
    });
    expect(getter).toHaveBeenCalledTimes(1);
  });
});
