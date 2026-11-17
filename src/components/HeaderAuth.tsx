import AuthButton from "@/components/AuthButton";
import { getCurrentUser } from "@/lib/auth/session";

/** Server component for the site header: Sign in / Sign out, hidden until Supabase is set up. */
export default async function HeaderAuth() {
  const { configured, user } = await getCurrentUser();
  return <AuthButton configured={configured} user={user ? { email: user.email ?? null } : null} />;
}
