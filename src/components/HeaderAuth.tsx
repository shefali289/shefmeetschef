import Link from "next/link";
import AuthButton from "@/components/AuthButton";
import { getCurrentUser } from "@/lib/auth/session";

const cookbookLink =
  "press inline-flex min-h-11 shrink-0 items-center rounded-full px-3 font-bold sm:px-4 text-cocoa hover:bg-blush-light focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper";

/** Server component for the site header: Cookbook (signed in) and Sign in / Sign out, hidden until Supabase is set up. */
export default async function HeaderAuth() {
  const { configured, user } = await getCurrentUser();
  return (
    <>
      {configured && user && (
        <Link href="/cookbook" className={cookbookLink}>
          Cookbook
        </Link>
      )}
      <AuthButton configured={configured} user={user ? { email: user.email ?? null } : null} />
    </>
  );
}
