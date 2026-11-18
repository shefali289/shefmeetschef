import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RemixCardData } from "@/lib/remix/types";

/*
 * Slice D review B2 contract: /remixes calls markOwn(viewer.supabase, viewer.user.id, cards) from
 * @/lib/remix/feed for a signed-in viewer, so their own approved remixes carry mine: true (no
 * Report button). Signed out it is not called with a user id (or not called at all).
 */

vi.mock("server-only", () => ({}));
const client = { marker: "session" };
const USER = { id: "b0000000-0000-4000-8000-000000000002", email: "cook@example.com" };
const card = (n: number, author: string): RemixCardData => ({
  id: `aaaaaaaa-0000-4000-8000-00000000000${n}`,
  recipeId: "11111111-1111-4111-8111-111111111111",
  recipeSlug: "masala-chai",
  recipeTitle: "Masala Chai",
  challengeId: null,
  changes: `remix ${n}`,
  authorName: author,
  likeCount: n,
  createdAt: "2026-11-18T01:00:00Z",
  photoUrl: null,
  liked: false,
});
const { state, markOwn, received } = vi.hoisted(() => ({
  state: { user: null as null | { id: string; email: string } },
  received: { cards: [] as unknown[] },
  markOwn: vi.fn(async <T extends { id: string }>(_sb: unknown, uid: string | null, cards: T[]) =>
    uid ? cards.map((c) => ({ ...c, mine: c.id.endsWith("2") })) : cards,
  ),
}));
vi.mock("@/lib/auth/session", () => ({
  getViewer: vi.fn(async () => ({ configured: true, user: state.user, supabase: client })),
}));
vi.mock("@/lib/recipes", () => ({ getRecipeBySlug: vi.fn(async () => null) }));
vi.mock("@/lib/remix/feed", () => ({
  asUuid: () => null,
  loadRemixFeed: vi.fn(async () => ({ cards: [card(1, "Priya"), card(2, "Me")], page: 1, hasMore: false })),
  markLiked: vi.fn(async <T,>(_sb: unknown, _uid: string, cards: T[]) => cards),
  markOwn,
}));
vi.mock("@/components/remix/RemixList", () => ({
  default: ({ remixes }: { remixes: (RemixCardData & { mine?: boolean })[] }) => {
    received.cards = remixes;
    return (
      <ul>
        {remixes.map((r) => (
          <li key={r.id} data-mine={String(r.mine === true)}>
            {r.authorName}
          </li>
        ))}
      </ul>
    );
  },
}));

import RemixesPage from "./page";

beforeEach(() => {
  markOwn.mockClear();
  received.cards = [];
});

describe("/remixes marks the viewer's own remixes", () => {
  it("signed in: markOwn runs with the session client and the viewer's id", async () => {
    state.user = USER;
    render(await RemixesPage({ searchParams: Promise.resolve({}) }));
    expect(markOwn).toHaveBeenCalledTimes(1);
    const [sb, uid, cards] = markOwn.mock.calls[0];
    expect(sb).toBe(client);
    expect(uid).toBe(USER.id);
    expect((cards as { id: string }[]).map((c) => c.id)).toEqual([card(1, "").id, card(2, "").id]);
    expect(screen.getByText("Me").closest("li")).toHaveAttribute("data-mine", "true");
    expect(screen.getByText("Priya").closest("li")).toHaveAttribute("data-mine", "false");
  });

  it("signed out: no own marking with a user id", async () => {
    state.user = null;
    render(await RemixesPage({ searchParams: Promise.resolve({}) }));
    for (const call of markOwn.mock.calls) expect(call[1]).toBeNull();
    expect(screen.getByText("Me").closest("li")).toHaveAttribute("data-mine", "false");
  });
});
