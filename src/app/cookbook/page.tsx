import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import CookbookAnnouncer from "@/components/cookbook/CookbookAnnouncer";
import DeleteReel from "@/components/cookbook/DeleteReel";
import FolderChips from "@/components/cookbook/FolderChips";
import FolderManager from "@/components/cookbook/FolderManager";
import { FOLDERS_HEADING_ID, REELS_HEADING_ID } from "@/components/cookbook/ids";
import MoveSave from "@/components/cookbook/MoveSave";
import RemoveSave from "@/components/cookbook/RemoveSave";
import Reveal from "@/components/motion/Reveal";
import RecipePlaceholder from "@/components/recipe/RecipePlaceholder";
import { getViewer } from "@/lib/auth/session";
import { loadCookbook, type CookbookItem } from "@/lib/cookbook/cookbook";
import { savesLimitReachedText, savesUsedText } from "@/lib/limits";

export const metadata: Metadata = { title: "My cookbook", robots: { index: false, follow: false } };
// Per-user page: never prerendered or cached.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ folder?: string | string[] }> };

const textLink =
  "inline-flex min-h-11 items-center font-bold text-copper-ink underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper";
const panel = "rounded-[1.75rem] bg-white/80 p-5 shadow-soft ring-1 ring-cocoa/10 sm:p-6";

type Folders = { id: string; name: string }[];

/** One saved recipe: a link to its page, then the controls for it. */
function SavedCard({ item, folders, reel = false }: { item: CookbookItem; folders: Folders; reel?: boolean }) {
  const { recipe } = item;
  return (
    <li className="flex flex-col overflow-hidden rounded-[1.75rem] bg-white shadow-soft ring-1 ring-cocoa/10">
      <Link
        href={`/recipes/${recipe.slug}`}
        className="lift group block focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper"
      >
        <div className="overflow-hidden">
          {recipe.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={recipe.cover_image_url} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
          ) : (
            <RecipePlaceholder className="aspect-[4/3] w-full" />
          )}
        </div>
        <h3 className="px-5 pt-4 font-script text-[2.1rem] leading-tight break-words tracking-[0.015em] text-cocoa">
          {recipe.title}
        </h3>
      </Link>
      <div className="mt-auto space-y-3 px-5 pt-2 pb-5">
        {/* A reel the user unsaved has no save to move. */}
        {item.saveId && (
          <MoveSave saveId={item.saveId} recipeTitle={recipe.title} folderId={item.folderId} folders={folders} />
        )}
        {reel && <DeleteReel recipeId={recipe.id} title={recipe.title} />}
      </div>
    </li>
  );
}

function Intro() {
  return (
    <div className="animate-fade-up">
      <p className="font-hand text-2xl text-herb">all your favourites in one place</p>
      <h1 className="mt-1 text-4xl font-extrabold text-cocoa">
        <span className="brush">My cookbook</span>
      </h1>
    </div>
  );
}

/** The signed-in user's saved recipes, folders and their own outside reels. */
export default async function CookbookPage({ searchParams }: Props) {
  const viewer = await getViewer();
  if (!viewer.configured || !viewer.supabase) {
    return (
      <main id="main" className="mx-auto max-w-2xl px-4 pt-8 pb-16">
        <Intro />
        <div className={`mt-8 space-y-3 ${panel}`}>
          <p className="font-semibold">Sorry, the cookbook is not set up yet. Check back soon!</p>
          <p>
            <Link href="/recipes" className={textLink}>
              Browse Shef&rsquo;s recipes
            </Link>
          </p>
        </div>
      </main>
    );
  }
  if (!viewer.user) redirect(`/sign-in?next=${encodeURIComponent("/cookbook")}`);

  const book = await loadCookbook(viewer.supabase, viewer.user.id);
  const param = (await searchParams).folder;
  const folderParam = Array.isArray(param) ? param[0] : param;
  const folder = book.folders.find((f) => f.id === folderParam) ?? null;
  const shown = folder ? folder.items : book.all;
  const folders = book.folders.map(({ id, name }) => ({ id, name }));
  const empty = book.all.length === 0 && book.myReels.length === 0 && book.unavailable.length === 0;
  // Only the user's own reels can be deleted from here (RLS allows nothing else).
  const reelIds = new Set(book.myReels.map((i) => i.recipe.id));

  return (
    <main id="main" className="mx-auto max-w-5xl px-4 pt-8 pb-16">
      <Intro />
      <p className="mt-3 text-lg font-semibold text-cocoa-soft">{savesUsedText(book.used, book.limit)}</p>
      <CookbookAnnouncer />
      {book.used >= book.limit && (
        <p role="status" className="mt-3 rounded-2xl bg-peach-light p-4 font-semibold text-cocoa ring-1 ring-cocoa/10">
          {savesLimitReachedText(book.limit)} Your own reels don&rsquo;t count toward this.
        </p>
      )}

      {empty ? (
        <div className={`mt-8 space-y-3 ${panel}`}>
          <p className="font-semibold">Nothing saved yet. Tap the heart on any recipe to keep it here.</p>
          <ul className="flex flex-wrap gap-x-6">
            <li>
              <Link href="/recipes" className={textLink}>
                Browse Shef&rsquo;s recipes
              </Link>
            </li>
            <li>
              <Link href="/add-reel" className={textLink}>
                Add a reel
              </Link>
            </li>
          </ul>
        </div>
      ) : (
        <section aria-labelledby="saves-heading" className="mt-8 space-y-5">
          <h2 id="saves-heading" className="text-3xl font-extrabold">
            <span className="brush">{folder ? folder.name : "All saves"}</span>
          </h2>
          <nav aria-label="Folders">
            <FolderChips folders={folders} selected={folder?.id ?? null} />
          </nav>
          {shown.length > 0 ? (
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((item) => (
                <SavedCard key={item.saveId ?? item.recipe.id} item={item} folders={folders} reel={reelIds.has(item.recipe.id)} />
              ))}
            </ul>
          ) : (
            <p className="font-semibold text-cocoa-soft">
              {folder ? "Nothing in this folder yet. Use Move on a recipe to file it here." : "No saved recipes yet."}
            </p>
          )}
          {!folder && book.unavailable.length > 0 && (
            <ul className="space-y-3">
              {book.unavailable.map((u) => (
                <li
                  key={u.saveId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-cocoa/10"
                >
                  <p className="font-semibold text-cocoa-soft">A recipe that is no longer available</p>
                  <RemoveSave saveId={u.saveId} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Reveal as="section" aria-labelledby={REELS_HEADING_ID} className="mt-12 space-y-5">
        <h2 id={REELS_HEADING_ID} tabIndex={-1} className="text-3xl font-extrabold focus:outline-none">
          <span className="brush">My reels</span>
        </h2>
        <p className="text-cocoa">
          Recipe cards you made from other people&rsquo;s reels. Only you can see them, and they don&rsquo;t
          count toward your saves.{" "}
          <Link href="/add-reel" className={textLink}>
            Add a reel
          </Link>
        </p>
        {book.myReels.length > 0 ? (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {book.myReels.map((item) => (
              <SavedCard key={item.recipe.id} item={item} folders={folders} reel />
            ))}
          </ul>
        ) : (
          <p className="font-semibold text-cocoa-soft">No reels yet.</p>
        )}
      </Reveal>

      <Reveal as="section" aria-labelledby={FOLDERS_HEADING_ID} className={`mt-12 space-y-4 ${panel}`}>
        <h2 id={FOLDERS_HEADING_ID} tabIndex={-1} className="text-2xl font-extrabold focus:outline-none">
          Folders
        </h2>
        <p className="text-cocoa">Make folders like &ldquo;Weeknights&rdquo; or &ldquo;Desserts&rdquo; to sort your saves.</p>
        <FolderManager folders={folders} />
      </Reveal>
    </main>
  );
}
