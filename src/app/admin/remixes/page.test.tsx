import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { BannedUser, QueueItem } from "@/lib/moderation/queue";

/*
 * Contract: /admin/remixes (src/app/admin/remixes/page.tsx), under the admin layout (noindex).
 * - adminGate() on the server; anything but "admin" renders nothing and loads nothing.
 * - loadModerationQueue(gate.supabase) -> { items, failed } and loadBannedUsers(gate.supabase) from
 *   @/lib/moderation/queue; photos signed with signRemixPhotos(gate.supabase, paths) from
 *   @/lib/remix/photos (the admin's own session, never a service client).
 * - Each queue item (an <article> or <li>) shows: the photo with alt "<authorName>'s remix of
 *   <recipeTitle>" (placeholder when it could not be signed), what they changed (plain text), the
 *   status ("Waiting for a quick check" / "Hidden by reports" / "Live, reported"), the AI reason
 *   when there is one, "N reports" and each report reason.
 * - Actions per item, each labelled with the author and recipe so screen reader users can tell
 *   them apart: "Approve <name>'s remix of <recipe>", "Hide <name>'s remix of <recipe>", and
 *   "Ban <name>" (or "Unban <name>" when the author is already banned). Forms post to
 *   approveRemix / hideRemix / banUser / unbanUser from ./actions.
 * - A "Banned cooks" section lists bans with their reason and an "Unban <name>" button.
 * - Empty queue: "Nothing to check". A failed load (failed: true) says "Couldn't load the queue"
 *   (role="alert") instead, never "Nothing to check" (slice D review B3).
 * - An item whose author is banned has no Approve button (approving it would be refused, SMM02);
 *   Hide and "Unban <name>" stay (slice D review NIT2).
 * - All buttons are 44px targets.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/image", () => import("@/test/next-image-mock"));

const { state, client } = vi.hoisted(() => ({
  state: {
    gate: "admin" as "admin" | "not-admin" | "signed-out" | "not-configured",
    queue: [] as unknown[],
    failed: false,
    banned: [] as unknown[],
    unsignable: [] as string[],
  },
  client: { from: () => { throw new Error("the page reads through the queue module"); }, rpc: () => { throw new Error("no rpc"); } },
}));

vi.mock("@/lib/auth/session", () => ({
  adminGate: vi.fn(async () =>
    state.gate === "admin"
      ? { state: "admin", user: { id: "a1", email: "shef@example.com" }, supabase: client }
      : state.gate === "not-admin"
        ? { state: "not-admin", user: { id: "u1" } }
        : { state: state.gate },
  ),
}));
const { loadModerationQueue, loadBannedUsers, signRemixPhotos } = vi.hoisted(() => ({
  loadModerationQueue: vi.fn(async (_c: unknown) => ({ items: state.failed ? [] : state.queue, failed: state.failed })),
  loadBannedUsers: vi.fn(async (_c: unknown) => state.banned),
  signRemixPhotos: vi.fn(async (_c: unknown, paths: string[]) =>
    Object.fromEntries(paths.map((p) => [p, state.unsignable.includes(p) ? null : `https://signed.example/${p}`])),
  ),
}));
vi.mock("@/lib/moderation/queue", () => ({
  loadModerationQueue,
  loadBannedUsers,
  countWaitingRemixes: vi.fn(async () => (state.failed ? null : state.queue.length)),
}));
vi.mock("@/lib/remix/photos", () => ({ signRemixPhotos, REMIX_PHOTOS_BUCKET: "remix-photos", REMIX_PHOTO_URL_SECONDS: 3600 }));
vi.mock("@/lib/supabase/service", () => ({ applyAiVerdict: vi.fn() }));
vi.mock("./actions", () => ({
  approveRemix: vi.fn(async () => ({})),
  hideRemix: vi.fn(async () => ({})),
  banUser: vi.fn(async () => ({})),
  unbanUser: vi.fn(async () => ({})),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (u: string) => {
    throw new Error(`NEXT_REDIRECT ${u}`);
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/remixes",
  useSearchParams: () => new URLSearchParams(),
}));

import AdminRemixesPage, { metadata } from "./page";

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const TARGET_44 = /(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/;

const item = (over: Partial<QueueItem>): QueueItem => ({
  id: "33333333-3333-4333-8333-333333333333",
  userId: A,
  authorName: "Priya",
  recipeTitle: "Masala Chai",
  recipeSlug: "masala-chai",
  photoPath: `${A}/p1.jpg`,
  changes: "Used oat milk and less sugar.",
  status: "pending",
  hiddenBy: null,
  aiVerdict: null,
  aiReason: null,
  reportCount: 0,
  reportReasons: [],
  createdAt: "2026-11-17T01:00:00Z",
  authorBanned: false,
  ...over,
});

const QUEUE: QueueItem[] = [
  item({
    id: "11111111-0000-4000-8000-000000000001",
    status: "hidden",
    hiddenBy: "reports",
    reportCount: 3,
    reportReasons: ["Not a real dish", "<b>rude</b>"],
    aiVerdict: "approve",
    aiReason: "A plate of food",
  }),
  item({
    id: "22222222-0000-4000-8000-000000000002",
    userId: B,
    authorName: "Sam",
    recipeTitle: "Paneer Tikka",
    recipeSlug: "paneer-tikka",
    photoPath: `${B}/p2.jpg`,
    changes: "<script>alert(1)</script> extra chilli",
    aiVerdict: "review",
    aiReason: "Hard to tell if this is food",
    authorBanned: true,
  }),
];
const BANNED: BannedUser[] = [{ userId: B, name: "Sam", reason: "Spam links", createdAt: "2026-11-16T00:00:00Z" }];

const render$ = async () => {
  const ui = await (AdminRemixesPage as unknown as () => Promise<React.ReactElement | null>)();
  return render(<>{ui}</>);
};
const card = (text: RegExp) => {
  const img = screen.getByRole("img", { name: text });
  const el = img.closest("article, li");
  expect(el).not.toBeNull();
  return within(el as HTMLElement);
};

beforeEach(() => {
  state.gate = "admin";
  state.queue = QUEUE;
  state.banned = BANNED;
  state.unsignable = [];
  state.failed = false;
  loadModerationQueue.mockClear();
  loadBannedUsers.mockClear();
  signRemixPhotos.mockClear();
});

describe("/admin/remixes", () => {
  it("shows each photo with alt text, what they changed, the AI reason, report count and reasons", async () => {
    const { container } = await render$();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/remix/i);

    const priya = card(/^Priya's remix of Masala Chai$/);
    expect(priya.getByRole("img")).toHaveAttribute("src", `https://signed.example/${A}/p1.jpg`);
    expect(priya.getByText("Used oat milk and less sugar.")).toBeInTheDocument();
    expect(priya.getByText(/A plate of food/)).toBeInTheDocument();
    expect(priya.getByText(/3 reports/i)).toBeInTheDocument();
    expect(priya.getByText(/Not a real dish/)).toBeInTheDocument();
    expect(priya.getByText(/hidden by reports/i)).toBeInTheDocument();

    const sam = card(/^Sam's remix of Paneer Tikka$/);
    expect(sam.getByText(/Hard to tell if this is food/)).toBeInTheDocument();
    expect(sam.getByText(/waiting for a quick check/i)).toBeInTheDocument();
    // user text and report reasons are plain text, never HTML
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(sam.getByText(/<script>alert\(1\)<\/script> extra chilli/)).toBeInTheDocument();
    expect(priya.getByText(/<b>rude<\/b>/)).toBeInTheDocument();
  });

  it("approve, hide and ban are labelled per remix", async () => {
    await render$();
    const priya = card(/^Priya's remix of Masala Chai$/);
    for (const name of [/approve priya's remix of masala chai/i, /hide priya's remix of masala chai/i, /^ban priya/i]) {
      const button = priya.getByRole("button", { name });
      expect(button.className).toMatch(TARGET_44);
    }
    const sam = card(/^Sam's remix of Paneer Tikka$/);
    // NIT2: Sam is banned, so approving is not offered (the database would refuse it)
    expect(sam.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(sam.getByRole("button", { name: /hide sam's remix of paneer tikka/i })).toBeInTheDocument();
    // Sam is banned already: unban instead of ban
    expect(sam.queryByRole("button", { name: /^ban sam/i })).toBeNull();
    expect(sam.getByRole("button", { name: /unban sam/i })).toBeInTheDocument();
    // remix ids are posted, not author names
    const approve = priya.getByRole("button", { name: /approve priya/i }).closest("form")!;
    expect((approve.querySelector('input[name="remix_id"]') as HTMLInputElement).value).toBe("11111111-0000-4000-8000-000000000001");
  });

  it("lists banned cooks with Unban", async () => {
    await render$();
    const section = screen.getByRole("heading", { name: /banned cooks/i }).closest("section")!;
    const s = within(section as HTMLElement);
    expect(s.getByText(/Spam links/)).toBeInTheDocument();
    const unban = s.getByRole("button", { name: /unban sam/i });
    expect(unban.className).toMatch(TARGET_44);
    expect((unban.closest("form")!.querySelector('input[name="user_id"]') as HTMLInputElement).value).toBe(B);
  });

  it("empty state says Nothing to check", async () => {
    state.queue = [];
    state.banned = [];
    await render$();
    expect(screen.getByText(/nothing to check/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
  });

  it("B3: a failed load says Couldn't load the queue instead of Nothing to check", async () => {
    state.failed = true;
    state.banned = [];
    await render$();
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t load the queue/i);
    expect(screen.queryByText(/nothing to check/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
  });

  it("photos are signed with the admin's session", async () => {
    state.unsignable = [`${B}/p2.jpg`];
    await render$();
    expect(loadModerationQueue).toHaveBeenCalledWith(client);
    expect(signRemixPhotos).toHaveBeenCalledWith(client, expect.arrayContaining([`${A}/p1.jpg`, `${B}/p2.jpg`]));
    // a photo that could not be signed is a placeholder, not a broken image
    expect(screen.queryByRole("img", { name: /^Sam's remix/ })?.getAttribute("src") ?? null).not.toBe("");
    for (const img of screen.queryAllByRole("img")) expect(img.getAttribute("src")).toBeTruthy();
  });

  it("renders nothing for non-admins (the layout explains) and is noindex", async () => {
    for (const gate of ["not-admin", "signed-out", "not-configured"] as const) {
      state.gate = gate;
      const { container, unmount } = await render$();
      expect(container.textContent).toBe("");
      unmount();
    }
    expect(loadModerationQueue).not.toHaveBeenCalled();
    expect(signRemixPhotos).not.toHaveBeenCalled();
    expect(metadata.robots).toMatchObject({ index: false });
  });
});
