import Link from "next/link";
import { cookies } from "next/headers";
import { adminGate } from "@/lib/auth/session";
import { countWaitingRemixes } from "@/lib/moderation/queue";
import { importNow } from "./actions";
import { readLastImportCookie, type LastImport } from "./last-import";

interface DraftListRow {
  id: string;
  title: string;
  slug: string;
  created_at: string;
  instagram_id: string | null;
  youtube_id: string | null;
}

function LastImportSummary({ last }: { last: LastImport | null }) {
  if (!last) return <p className="mt-3">No import has been run from this browser yet.</p>;
  const when = new Date(last.at).toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="mt-3 rounded-lg border border-shef-navy/15 bg-white p-4">
      <p className="font-semibold">Last import: {when}</p>
      {last.error ? (
        <p role="alert" className="mt-2">
          Import did not run: {last.error}
        </p>
      ) : (
        <p className="mt-2">
          {last.imported} imported, {last.skipped} skipped (already imported or seen before),{" "}
          {last.noRecipeCount} skipped: no recipe, {last.failedCount} failed.
          {last.remaining > 0 && ` ${last.remaining} more waiting: run Import now again.`}
        </p>
      )}
      {last.sourceErrors.length > 0 && (
        <ul role="alert" className="mt-2 list-disc pl-6">
          {last.sourceErrors.map((e) => (
            <li key={e.source}>
              {e.source === "instagram" ? "Instagram" : "YouTube"} could not be read: {e.error}
            </li>
          ))}
        </ul>
      )}
      {last.noRecipe.length > 0 && (
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer py-2">
            Skipped: no recipe{last.noRecipeCount > last.noRecipe.length ? ` (first ${last.noRecipe.length})` : ""}
          </summary>
          <ul className="list-disc pl-6">
            {last.noRecipe.map((r) => (
              <li key={`${r.source}-${r.id}`}>
                <a href={r.url} className="underline" rel="noopener noreferrer" target="_blank">
                  {r.source} post {r.id}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {last.failed.length > 0 && (
        <details className="mt-2" open>
          <summary className="min-h-11 cursor-pointer py-2">
            Failed{last.failedCount > last.failed.length ? ` (first ${last.failed.length})` : ""}
          </summary>
          <ul className="list-disc pl-6">
            {last.failed.map((r) => (
              <li key={`${r.source}-${r.id}`}>
                <a href={r.url} className="underline" rel="noopener noreferrer" target="_blank">
                  {r.source} post {r.id}
                </a>
                {r.error ? `: ${r.error}` : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ published?: string }>;
}) {
  const gate = await adminGate();
  if (gate.state !== "admin") return null; // the layout already shows the right message

  const [{ data, error }, waiting] = await Promise.all([
    gate.supabase
      .from("recipes")
      .select("id, title, slug, created_at, instagram_id, youtube_id")
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .returns<DraftListRow[]>(),
    countWaitingRemixes(gate.supabase),
  ]);
  const drafts = data ?? [];
  const last = readLastImportCookie(await cookies());
  const { published } = await searchParams;

  return (
    <main>
      <h1 className="text-3xl font-bold">Admin</h1>
      {published && (
        <p role="status" className="mt-3 rounded-lg border border-herb bg-herb-light p-3">
          Recipe published.
        </p>
      )}

      <nav aria-label="Admin sections" className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/admin/remixes"
          className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-copper bg-white px-5 font-semibold text-cocoa hover:bg-blush-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
        >
          Remixes to check
          {waiting !== null && waiting > 0 && (
            <span className="rounded-full bg-copper px-2 py-0.5 text-sm font-bold text-white">{waiting} waiting</span>
          )}
        </Link>
        <Link
          href="/admin/challenges"
          className="inline-flex min-h-11 items-center rounded-full border-2 border-copper bg-white px-5 font-semibold text-cocoa hover:bg-blush-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
        >
          Weekly challenges
        </Link>
      </nav>

      <section aria-labelledby="import-heading" className="mt-6">
        <h2 id="import-heading" className="text-xl font-bold">
          Import from Instagram and YouTube
        </h2>
        <form action={importNow} className="mt-3">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-full bg-shef-orange px-6 font-semibold text-white hover:bg-shef-orange-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shef-orange"
          >
            Import now
          </button>
        </form>
        <LastImportSummary last={last} />
      </section>

      <section aria-labelledby="drafts-heading" className="mt-8">
        <h2 id="drafts-heading" className="text-xl font-bold">
          Drafts
        </h2>
        {error ? (
          <p role="alert" className="mt-3">
            Could not load drafts: {error.message}
          </p>
        ) : drafts.length === 0 ? (
          <p className="mt-3">No drafts waiting. Import to bring in new posts.</p>
        ) : (
          <ul className="mt-3 divide-y divide-shef-navy/10 rounded-lg border border-shef-navy/15 bg-white">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/admin/recipes/${d.id}`}
                  className="flex min-h-11 flex-col px-4 py-3 hover:bg-shef-cream focus-visible:outline-2 focus-visible:outline-shef-orange"
                >
                  <span className="font-semibold">Edit {d.title}</span>
                  <span className="text-sm">
                    {d.instagram_id ? "Instagram" : d.youtube_id ? "YouTube" : "Manual"} · added{" "}
                    {new Date(d.created_at).toLocaleDateString("en-NZ", { dateStyle: "medium" })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
