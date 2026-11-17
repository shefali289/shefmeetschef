import Link from "next/link";

export interface AuthButtonProps {
  configured: boolean;
  user: { email: string | null } | null;
}

const control =
  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shef-orange";

/** Sign in link or sign out button. Renders nothing until Supabase is set up. */
export default function AuthButton({ configured, user }: AuthButtonProps) {
  if (!configured) return null;
  if (!user) {
    return (
      <Link href="/sign-in" className={`${control} bg-shef-orange text-white hover:bg-shef-orange-dark`}>
        Sign in
      </Link>
    );
  }
  return (
    <form action="/auth/sign-out" method="post">
      <button
        type="submit"
        className={`${control} border border-shef-navy/30 text-shef-navy hover:bg-shef-navy/5`}
        title={user.email ? `Signed in as ${user.email}` : undefined}
      >
        Sign out
      </button>
    </form>
  );
}
