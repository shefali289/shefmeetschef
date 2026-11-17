import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/image", () => import("@/test/next-image-mock"));

/*
 * Contract: /cookbook (src/app/cookbook/page.tsx), async server component
 *   CookbookPage({ searchParams: Promise<{ folder?: string }> })
 * - Not configured (createSupabaseServerClient() is null): "not set up yet", no data read.
 * - Signed out: redirect("/sign-in?next=%2Fcookbook").
 * - Signed in: loadCookbook(<the user's client>, <user id>) from @/lib/cookbook/cookbook, then shows
 *   "<used> of <limit> saves used", folder chips, the recipes (links to /recipes/<slug>), a
 *   "My reels" section (heading) and, when there are no saves at all, links to /recipes and /add-reel.
 * - ?folder=<id> shows that folder's recipes; an unknown id shows All saves.
 * - The page is private: metadata.robots.index is false.
 */

const { createSupabaseServerClient, loadCookbook, redirect } = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  loadCookbook: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("@/lib/cookbook/cookbook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cookbook/cookbook")>()),
  loadCookbook,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect,
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cookbook",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./actions", () => ({
  toggleSave: vi.fn(async () => ({})),
  createFolder: vi.fn(async () => ({})),
  renameFolder: vi.fn(async () => ({})),
  deleteFolder: vi.fn(async () => ({})),
  moveSave: vi.fn(async () => ({})),
  removeSave: vi.fn(async () => ({})),
}));
vi.mock("./reel-actions", () => ({ deleteReel: vi.fn(async () => ({})) }));

import CookbookPage, * as pageModule from "./page";
import type { Cookbook, CookbookItem } from "@/lib/cookbook/cookbook";

const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const F_DESSERTS = "f0000000-0000-4000-8000-000000000001";
const F_BREAKFAST = "f0000000-0000-4000-8000-000000000002";

let currentUser: typeof USER | null = USER;
const client = { auth: { getUser: async () => ({ data: { user: currentUser }, error: null }) }, from: vi.fn() };

function item(n: number, opts: { folder?: string | null; outside?: boolean } = {}): CookbookItem {
  const outside = opts.outside ?? false;
  return {
    saveId: `s0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    folderId: opts.folder ?? null,
    savedAt: `2026-11-${String(n).padStart(2, "0")}T00:00:00Z`,
    recipe: {
      id: `r0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      slug: outside ? `reel-reel-dish-${n}-abc123` : `dish-${n}`,
      title: outside ? `Reel Dish ${n}` : `Dish ${n}`,
      cover_image_url: null,
      source: outside ? "outside" : "shef",
    },
  };
}

function cookbook(): Cookbook {
  const all = Array.from({ length: 12 }, (_, i) => item(12 - i, { folder: 12 - i === 3 ? F_DESSERTS : null }));
  const myReels = [item(20, { outside: true }), item(21, { outside: true })];
  return {
    all,
    myReels,
    folders: [
      { id: F_BREAKFAST, name: "Breakfast", items: [] },
      { id: F_DESSERTS, name: "Desserts", items: [all.find((i) => i.recipe.slug === "dish-3")!] },
    ],
    unavailable: [],
    used: 12,
    limit: 30,
  };
}

const empty: Cookbook = { all: [], myReels: [], folders: [], unavailable: [], used: 0, limit: 30 };

async function renderPage(folder?: string) {
  const ui = await CookbookPage({ searchParams: Promise.resolve(folder ? { folder } : {}) });
  return render(ui as unknown as React.ReactElement);
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  const err = (await p.then(
    () => {
      throw new Error("expected a redirect");
    },
    (e: unknown) => e,
  )) as { digest?: string };
  expect(err.digest).toMatch(/^NEXT_REDIRECT;/);
  return err.digest!.slice("NEXT_REDIRECT;".length);
}

beforeEach(() => {
  currentUser = USER;
  createSupabaseServerClient.mockReset();
  createSupabaseServerClient.mockImplementation(async () => client);
  loadCookbook.mockReset();
  loadCookbook.mockImplementation(async () => cookbook());
  redirect.mockClear();
});

describe("/cookbook page", () => {
  it("shows 12 of 30 saves used", async () => {
    await renderPage();
    expect(screen.getByText(/12 of 30 saves used/)).toBeInTheDocument();
    // My reels are read for this user (their own outside recipes), so the id is passed in
    expect(loadCookbook).toHaveBeenCalledWith(client, USER.id);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    // All saves lists every counted recipe, linking to its page.
    expect(screen.getByRole("link", { name: /^Dish 12$/ })).toHaveAttribute("href", "/recipes/dish-12");
    expect(screen.getByRole("link", { name: /all saves/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Desserts" })).toHaveAttribute("href", `/cookbook?folder=${F_DESSERTS}`);
  });

  it("shows My reels section", async () => {
    await renderPage();
    const heading = screen.getByRole("heading", { name: /my reels/i });
    const section = heading.closest("section") ?? heading.parentElement!;
    const reels = within(section as HTMLElement);
    expect(reels.getByRole("link", { name: /Reel Dish 20/ })).toHaveAttribute("href", "/recipes/reel-reel-dish-20-abc123");
    expect(reels.getByRole("link", { name: /Reel Dish 21/ })).toBeInTheDocument();
    expect(reels.queryByRole("link", { name: /^Dish 12$/ })).not.toBeInTheDocument();
  });

  it("?folder= shows only that folder's recipes; an unknown folder shows All saves", async () => {
    const { unmount } = await renderPage(F_DESSERTS);
    expect(screen.getByRole("link", { name: /^Dish 3$/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Dish 12$/ })).not.toBeInTheDocument();
    unmount();

    await renderPage("f0000000-0000-4000-8000-0000000000ff");
    expect(screen.getByRole("link", { name: /^Dish 12$/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Dish 3$/ })).toBeInTheDocument();
  });

  it("each save can be moved and the folder manager is shown", async () => {
    await renderPage();
    expect(screen.getByRole("combobox", { name: /move dish 12/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^(new )?folder name$/i)).toBeInTheDocument();
  });

  it("a save whose recipe is no longer available is listed with a Remove button", async () => {
    const GONE = "s0000000-0000-4000-8000-000000000099";
    loadCookbook.mockImplementation(async () => ({ ...cookbook(), unavailable: [{ saveId: GONE }], used: 13 }));
    await renderPage();
    expect(screen.getByText(/13 of 30 saves used/)).toBeInTheDocument();
    const notice = screen.getByText(/a recipe that is no longer available/i);
    const row = (notice.closest("li") ?? notice.parentElement!) as HTMLElement;
    const remove = within(row).getByRole("button", { name: /remove/i });
    const formEl = remove.closest("form");
    expect(formEl).not.toBeNull();
    const saveField = formEl!.querySelector<HTMLInputElement>('input[name="save_id"]');
    expect(saveField?.value).toBe(GONE);
  });

  it("an unsaved reel still shows in My reels with Delete", async () => {
    const unsaved: CookbookItem = { ...item(22, { outside: true }), saveId: null as unknown as string, folderId: null };
    loadCookbook.mockImplementation(async () => ({ ...cookbook(), myReels: [unsaved] }));
    await renderPage();
    const heading = screen.getByRole("heading", { name: /my reels/i });
    const section = within((heading.closest("section") ?? heading.parentElement!) as HTMLElement);
    expect(section.getByRole("link", { name: /Reel Dish 22/ })).toBeInTheDocument();
    expect(section.getByRole("button", { name: "Delete Reel Dish 22" })).toBeInTheDocument();
    // there is no save to move, so no Move control for it
    expect(section.queryByRole("combobox", { name: /move reel dish 22/i })).not.toBeInTheDocument();
    // and it is not counted
    expect(screen.getByText(/12 of 30 saves used/)).toBeInTheDocument();
  });

  it("empty state links to /recipes and /add-reel", async () => {
    loadCookbook.mockImplementation(async () => empty);
    await renderPage();
    expect(screen.getByText(/0 of 30 saves used/)).toBeInTheDocument();
    const hrefs = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/recipes");
    expect(hrefs).toContain("/add-reel");
  });

  it("signed-out redirects to sign-in", async () => {
    currentUser = null;
    const to = await redirectOf(CookbookPage({ searchParams: Promise.resolve({}) }));
    expect(to).toBe(`/sign-in?next=${encodeURIComponent("/cookbook")}`);
    expect(loadCookbook).not.toHaveBeenCalled();
  });

  it("not configured shows not set up yet", async () => {
    createSupabaseServerClient.mockImplementation(async () => null);
    await renderPage();
    expect(screen.getByText(/not set up yet/i)).toBeInTheDocument();
    expect(loadCookbook).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("is never indexed", () => {
    const metadata = (pageModule as { metadata?: { robots?: { index?: boolean } } }).metadata;
    expect(metadata?.robots?.index).toBe(false);
  });
});
