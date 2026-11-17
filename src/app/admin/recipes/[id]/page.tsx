import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import DraftForm from "@/components/admin/DraftForm";
import { adminGate } from "@/lib/auth/session";
import { RecipeSchema } from "@/lib/types";
import { updateDraft } from "../../actions";

export default async function EditDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const gate = await adminGate();
  if (gate.state !== "admin") return null; // the layout already shows the right message

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { saved } = await searchParams;

  const { data } = await gate.supabase.from("recipes").select("*").eq("id", id).maybeSingle();
  const parsed = RecipeSchema.safeParse(data);
  if (!parsed.success) notFound();
  const recipe = parsed.data;

  return (
    <main>
      <p>
        <Link href="/admin" className="inline-flex min-h-11 items-center font-semibold text-shef-orange underline underline-offset-4">
          Back to admin
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold">
        {recipe.status === "live" ? "Edit recipe" : "Edit draft"}
      </h1>
      {saved && (
        <p role="status" className="mt-3 rounded-lg border border-herb bg-herb-light p-3">
          Saved.
        </p>
      )}
      {(recipe.reel_url || recipe.youtube_url) && (
        <p className="mt-3">
          Source:{" "}
          <a
            href={recipe.reel_url ?? recipe.youtube_url ?? undefined}
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            original post
          </a>
        </p>
      )}
      <div className="mt-6">
        <DraftForm recipe={recipe} action={updateDraft} />
      </div>
    </main>
  );
}
