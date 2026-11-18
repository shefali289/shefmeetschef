import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OwnRemixCard, RemixCardData } from "@/lib/remix/types";

/*
 * Task 3 slice D contract for <RemixCard> (extends the slice B contract in RemixCard.test.tsx):
 * - A public (approved) card shows <ReportButton> next to the like heart: "Report" when signed in,
 *   "Sign in to report" when signed out.
 * - The owner's own card (ownStatus set) never shows Report, and neither does a public card the
 *   viewer posted (remix.mine === true, set by markOwn in src/lib/remix/feed.ts).
 * - The owner's status text uses statusLabel(status, { hiddenBy, aiReason }) from the card's
 *   hiddenBy / aiReason (OwnRemixCard): "Hidden: <reason>" when the AI hid it,
 *   "Hidden while Shef takes a look" when reports hid it.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/image", () => import("@/test/next-image-mock"));
vi.mock("@/app/remixes/actions", () => ({
  deleteRemix: vi.fn(async () => ({ ok: true })),
  toggleLike: vi.fn(async () => ({ ok: true, liked: true })),
}));
const { reportRemix } = vi.hoisted(() => ({ reportRemix: vi.fn(async () => ({ ok: true, message: "Reported, thanks" })) }));
vi.mock("@/app/remixes/report-actions", () => ({ reportRemix }));

import RemixCard from "./RemixCard";

const card = (over: Partial<OwnRemixCard> = {}): RemixCardData =>
  ({
    id: "33333333-3333-4333-8333-333333333333",
    recipeId: "11111111-1111-4111-8111-111111111111",
    recipeSlug: "masala-chai",
    recipeTitle: "Masala Chai",
    challengeId: null,
    changes: "Used oat milk.",
    authorName: "Priya",
    likeCount: 2,
    createdAt: "2026-11-18T01:00:00Z",
    photoUrl: "https://signed.example/p.jpg",
    liked: false,
    ...over,
  }) as RemixCardData;

beforeEach(() => reportRemix.mockClear());

describe("RemixCard reporting", () => {
  it("an approved card offers Report when signed in", () => {
    render(<RemixCard remix={card()} signedIn returnTo="/recipes/masala-chai" />);
    expect(screen.getByRole("button", { name: /^report/i })).toHaveAccessibleName(/Priya/);
    // the like heart is still there
    expect(screen.getByRole("button", { name: /like/i })).toBeInTheDocument();
  });

  it("signed out it offers Sign in to report", () => {
    render(<RemixCard remix={card()} signedIn={false} returnTo="/remixes" />);
    expect(screen.getByRole("link", { name: /sign in to report/i })).toHaveAttribute("href", `/sign-in?next=${encodeURIComponent("/remixes")}`);
  });

  it("the owner's own card never shows Report", () => {
    for (const status of ["approved", "pending", "hidden"] as const) {
      const { unmount } = render(<RemixCard remix={card()} signedIn ownStatus={status} returnTo="/recipes/masala-chai" />);
      expect(screen.queryByRole("button", { name: /^report/i })).toBeNull();
      expect(screen.queryByRole("link", { name: /report/i })).toBeNull();
      unmount();
    }
  });

  it("B2: a public card marked as the viewer's own (mine) shows no Report button", () => {
    // markOwn sets `mine` on feed cards the viewer posted (RemixCardData.mine?: boolean)
    const mine = { ...card(), mine: true } as RemixCardData;
    const { unmount } = render(<RemixCard remix={mine} signedIn returnTo="/remixes" />);
    expect(screen.queryByRole("button", { name: /^report/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /report/i })).toBeNull();
    // still a public card: the like heart stays
    expect(screen.getByRole("button", { name: /like/i })).toBeInTheDocument();
    unmount();
    // mine: false behaves like any other card
    render(<RemixCard remix={{ ...card(), mine: false } as RemixCardData} signedIn returnTo="/remixes" />);
    expect(screen.getByRole("button", { name: /^report/i })).toBeInTheDocument();
  });

  it("the owner's hidden card explains why: the AI reason, or while Shef takes a look", () => {
    const { unmount } = render(
      <RemixCard
        remix={card({ hiddenBy: "ai", aiReason: "The photo doesn't seem to show food." })}
        signedIn
        ownStatus="hidden"
        returnTo="/recipes/masala-chai"
      />,
    );
    expect(screen.getByText("Hidden: The photo doesn't seem to show food.")).toBeInTheDocument();
    unmount();

    render(<RemixCard remix={card({ hiddenBy: "reports", aiReason: null })} signedIn ownStatus="hidden" returnTo="/recipes/masala-chai" />);
    expect(screen.getByText("Hidden while Shef takes a look")).toBeInTheDocument();
  });
});
