// Pure check: callers pass a getter that reads the user and profile server-side.

export interface AuthUser {
  id: string;
  email?: string | null;
}

export interface AuthProfile {
  id: string;
  is_admin: boolean;
}

export type UserAndProfile = { user: AuthUser; profile: AuthProfile | null };

export class NotSignedInError extends Error {
  constructor(message = "Not signed in") {
    super(message);
    this.name = "NotSignedInError";
  }
}

export class NotAdminError extends Error {
  constructor(message = "Admins only") {
    super(message);
    this.name = "NotAdminError";
  }
}

/**
 * Resolves only for a signed-in user whose own profile row has is_admin === true.
 * Throws NotSignedInError or NotAdminError otherwise.
 */
export async function requireAdmin(
  getUserAndProfile: () => Promise<UserAndProfile | null>,
): Promise<{ user: AuthUser; profile: AuthProfile }> {
  const result = await getUserAndProfile();
  if (!result?.user) throw new NotSignedInError();
  const { user, profile } = result;
  if (!profile || profile.id !== user.id || profile.is_admin !== true) throw new NotAdminError();
  return { user, profile };
}
