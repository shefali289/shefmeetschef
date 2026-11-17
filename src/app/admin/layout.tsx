import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { adminSignInPath } from "@/lib/auth/admin-sign-in";
import { adminGate } from "@/lib/auth/session";
import { PATHNAME_HEADER } from "@/lib/supabase/middleware";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-4 py-10 text-shef-navy">
      <h1 className="text-3xl font-bold">{title}</h1>
      <div className="mt-4 rounded-lg border border-shef-navy/20 bg-white p-4">{children}</div>
    </main>
  );
}

/** Every admin page is checked here on the server; actions check again themselves. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const gate = await adminGate();

  if (gate.state === "not-configured") {
    return (
      <Notice title="Admin">
        <p>Admins sign in to import and publish recipes, but sign-in is not set up yet.</p>
      </Notice>
    );
  }
  if (gate.state === "signed-out") {
    redirect(adminSignInPath((await headers()).get(PATHNAME_HEADER) ?? "/admin"));
  }
  if (gate.state === "not-admin") {
    return (
      <Notice title="Admins only">
        <p>You are signed in, but this area is only for Shef&apos;s admins (403).</p>
        <p className="mt-3">
          <Link href="/" className="font-semibold text-shef-orange underline underline-offset-4">
            Back to recipes
          </Link>
        </p>
      </Notice>
    );
  }
  return <div className="mx-auto max-w-3xl px-4 py-8 text-shef-navy">{children}</div>;
}
