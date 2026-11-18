import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RemixCardData } from "@/lib/remix/types";

/*
 * Contract: <RemixCard remix signedIn returnTo ownStatus? />
 * - Photo (signed URL) with alt "<authorName>'s remix of <recipeTitle>"; no URL: the recipe
 *   placeholder (data-testid "recipe-placeholder"), never an <img> without a src.
 * - The author's first name, "what they changed" as plain text (never HTML), and the like count
 *   through <LikeButton> (approved remixes only).
 * - ownStatus set (the owner's own card): the status text from statusLabel ("Live", "Waiting for a
 *   quick check", "Hidden") and a "Delete my remix" button that asks inline before posting
 *   remix_id to deleteRemix from @/app/remixes/actions. No like button on a pending or hidden remix.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/image", () => import("@/test/next-image-mock"));
const { deleteRemix, toggleLike } = vi.hoisted(() => ({
  deleteRemix: vi.fn(async () => ({ ok: true })),
  toggleLike: vi.fn(async () => ({ ok: true, liked: true })),
}));
vi.mock("@/app/remixes/actions", () => ({ deleteRemix, toggleLike }));

import CookbookAnnouncer from "@/components/cookbook/CookbookAnnouncer";
import RemixCard from "./RemixCard";

const REMIX = "33333333-3333-4333-8333-333333333333";
const card = (over: Partial<RemixCardData> = {}): RemixCardData => ({
  id: REMIX,
  recipeId: "11111111-1111-4111-8111-111111111111",
  recipeSlug: "masala-chai",
  recipeTitle: "Masala Chai",
  challengeId: null,
  changes: "Used oat milk and a little jaggery.",
  authorName: "Priya",
  likeCount: 7,
  createdAt: "2026-11-18T01:00:00Z",
  photoUrl: "https://abc.supabase.co/storage/v1/object/sign/remix-photos/u/p.jpg?token=t",
  liked: false,
  ...over,
});

beforeEach(() => {
  deleteRemix.mockClear();
  toggleLike.mockClear();
});

describe("RemixCard", () => {
  it("photo alt is <name>'s remix of <recipe>", () => {
    render(<RemixCard remix={card()} signedIn returnTo="/recipes/masala-chai" />);
    const img = screen.getByRole("img", { name: "Priya's remix of Masala Chai" });
    expect(img).toHaveAttribute("src", card().photoUrl);
    // the first name is shown as text too
    expect(screen.getAllByText(/Priya/).length).toBeGreaterThan(0);
  });

  it("a photo that could not be signed shows a placeholder", () => {
    const { container } = render(<RemixCard remix={card({ photoUrl: null })} signedIn returnTo="/remixes" />);
    expect(screen.getByTestId("recipe-placeholder")).toBeInTheDocument();
    for (const img of container.querySelectorAll("img")) expect(img.getAttribute("src")).toBeTruthy();
  });

  it("what they changed is plain text, not HTML", () => {
    const evil = '<img src=x onerror="alert(1)"><b>bold</b> <a href="javascript:alert(1)">link</a>';
    const { container } = render(<RemixCard remix={card({ changes: evil })} signedIn returnTo="/remixes" />);
    expect(screen.getByText(evil)).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("shows the like count", () => {
    render(<RemixCard remix={card({ likeCount: 7 })} signedIn returnTo="/remixes" />);
    expect(screen.getByRole("button", { name: /like/i })).toHaveAccessibleName(/\b7\b/);

    // signed out, the count is still shown next to the sign-in link
    render(<RemixCard remix={card({ id: "44444444-4444-4444-8444-444444444444", likeCount: 12 })} signedIn={false} returnTo="/remixes" />);
    expect(screen.getByRole("link", { name: /sign in to like/i })).toBeInTheDocument();
    expect(document.body).toHaveTextContent(/\b12\b/);
  });

  it("owner view shows the status text and a delete button that asks to confirm", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <RemixCard remix={card({ likeCount: 0 })} signedIn returnTo="/recipes/masala-chai" ownStatus="pending" />,
    );
    const view = within(container);
    expect(view.getByText("Waiting for a quick check")).toBeInTheDocument();
    // a pending remix cannot be liked yet
    expect(view.queryByRole("button", { name: /^like|likes?\b/i })).toBeNull();

    await user.click(view.getByRole("button", { name: /delete my remix/i }));
    expect(deleteRemix).not.toHaveBeenCalled();
    expect(view.getAllByText(/delete/i, { selector: "p" }).length).toBeGreaterThan(0);
    await user.click(view.getByRole("button", { name: /cancel/i }));
    expect(deleteRemix).not.toHaveBeenCalled();

    await user.click(view.getByRole("button", { name: /delete my remix/i }));
    await user.click(view.getByRole("button", { name: /yes, delete/i }));
    await waitFor(() => expect(deleteRemix).toHaveBeenCalledTimes(1));
    const fd = (deleteRemix.mock.calls[0] as unknown[])[1] as FormData;
    expect(fd.get("remix_id")).toBe(REMIX);
    expect(fd.get("photo_path")).toBeNull(); // the server takes the path from the deleted row

    for (const [status, label] of [
      ["approved", "Live"],
      ["hidden", "Hidden"],
    ] as const) {
      const { container: c } = render(<RemixCard remix={card()} signedIn returnTo="/remixes" ownStatus={status} />);
      expect(within(c).getByText(label)).toBeInTheDocument();
      expect(within(c).getByRole("button", { name: /delete my remix/i })).toBeInTheDocument();
    }

    // the public card never offers delete
    const { container: pub } = render(<RemixCard remix={card()} signedIn returnTo="/remixes" />);
    expect(within(pub).queryByRole("button", { name: /delete/i })).toBeNull();
    expect(within(pub).queryByText(/Waiting for a quick check/)).toBeNull();
  });

  /* ---------- slice B review findings ---------- */
  it("B1: after Delete my remix, focus moves to the remixes heading and Remix deleted is announced", async () => {
    const user = userEvent.setup();
    render(
      <section aria-labelledby="remixes-heading">
        <h2 id="remixes-heading" tabIndex={-1}>
          Remixes
        </h2>
        {/* the page's persistent status region, outside every card */}
        <CookbookAnnouncer />
        <RemixCard remix={card()} signedIn returnTo="/recipes/masala-chai" ownStatus="approved" />
      </section>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/^\s*$/);

    await user.click(screen.getByRole("button", { name: /delete my remix/i }));
    await user.click(screen.getByRole("button", { name: /yes, delete/i }));
    await waitFor(() => expect(deleteRemix).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(status).toHaveTextContent("Remix deleted"));
    // focus is not lost with the card: it lands on the stable heading
    await waitFor(() => expect(document.getElementById("remixes-heading")).toHaveFocus());
  });

  it("NIT11: the recipe link is a 44px target", () => {
    render(<RemixCard remix={card()} signedIn returnTo="/remixes" />);
    const link = screen.getByRole("link", { name: "Masala Chai" });
    expect(link).toHaveAttribute("href", "/recipes/masala-chai");
    expect(link.className).toMatch(/(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/);
  });
});

