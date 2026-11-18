import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * Contract: <LikeButton remixId authorName count liked signedIn returnTo /> ("use client").
 * - Signed in: a form posting remix_id, intent ("like" when not liked, "unlike" when liked) and
 *   return_to to toggleLike from @/app/remixes/actions. Its submit button has aria-pressed = liked
 *   and an accessible name with the author and the like count (e.g. "Like Priya's remix, 3 likes").
 * - The press and count change at once (optimistic) and settle on the server's answer; a refused
 *   like goes back and its error is announced (role="alert").
 * - Signed out: a "Sign in to like" link to /sign-in?next=<encoded returnTo>, count still shown.
 * - 44px target; the heart icon is decorative.
 */

const { toggleLike } = vi.hoisted(() => ({
  toggleLike: vi.fn(async (_prev: unknown, fd: FormData) => ({ ok: true, liked: fd.get("intent") === "like" })),
}));
vi.mock("@/app/remixes/actions", () => ({ toggleLike, deleteRemix: vi.fn(async () => ({ ok: true })) }));

import LikeButton from "./LikeButton";

const REMIX = "33333333-3333-4333-8333-333333333333";
const TARGET_44 = /(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/;
const WIDTH_44 = /(^|\s)(min-w|w|size)-(1[1-9]|[2-9]\d)(\s|$)/;

const heart = () => screen.getByRole("button", { name: /like/i });

beforeEach(() => {
  toggleLike.mockClear();
});

describe("LikeButton", () => {
  it("aria-pressed heart labelled with the author and count", async () => {
    const user = userEvent.setup();
    render(<LikeButton remixId={REMIX} authorName="Priya" count={3} liked={false} signedIn returnTo="/recipes/masala-chai" />);
    const button = heart();
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAccessibleName(/Priya/);
    expect(button).toHaveAccessibleName(/\b3\b/);

    await user.click(button);
    await waitFor(() => expect(toggleLike).toHaveBeenCalledTimes(1));
    const fd = toggleLike.mock.calls[0][1] as FormData;
    expect(fd.get("remix_id")).toBe(REMIX);
    expect(fd.get("intent")).toBe("like");
    expect(fd.get("return_to")).toBe("/recipes/masala-chai");

    // a liked remix posts unlike
    render(<LikeButton remixId={REMIX} authorName="Sam" count={1} liked signedIn returnTo="/remixes" />);
    const sams = screen.getByRole("button", { name: /Sam/ });
    expect(sams).toHaveAttribute("aria-pressed", "true");
    await user.click(sams);
    await waitFor(() => expect(toggleLike).toHaveBeenCalledTimes(2));
    expect((toggleLike.mock.calls[1][1] as FormData).get("intent")).toBe("unlike");
  });

  it("signed-out shows a sign-in link", () => {
    render(<LikeButton remixId={REMIX} authorName="Priya" count={3} liked={false} signedIn={false} returnTo="/recipes/masala-chai" />);
    expect(screen.queryByRole("button")).toBeNull();
    const link = screen.getByRole("link", { name: /sign in to like/i });
    expect(link).toHaveAttribute("href", `/sign-in?next=${encodeURIComponent("/recipes/masala-chai")}`);
    // the count is still visible to everyone
    expect(document.body).toHaveTextContent(/\b3\b/);
  });

  it("count updates at once", async () => {
    let finish!: (v: { ok: boolean; liked: boolean }) => void;
    toggleLike.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const user = userEvent.setup();
    render(<LikeButton remixId={REMIX} authorName="Priya" count={3} liked={false} signedIn returnTo="/remixes" />);
    await user.click(heart());
    // before the server answers
    await waitFor(() => expect(heart()).toHaveAttribute("aria-pressed", "true"));
    expect(heart()).toHaveAccessibleName(/\b4\b/);
    finish({ ok: true, liked: true });
    await waitFor(() => expect(toggleLike).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(heart()).toHaveAccessibleName(/\b4\b/));
    expect(heart()).toHaveAttribute("aria-pressed", "true");
  });

  it("a refused like goes back and is announced", async () => {
    toggleLike.mockImplementationOnce(async () => ({ liked: false, error: "You can't like this remix right now." }) as never);
    const user = userEvent.setup();
    render(<LikeButton remixId={REMIX} authorName="Priya" count={3} liked={false} signedIn returnTo="/remixes" />);
    await user.click(heart());
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't like/i);
    expect(heart()).toHaveAttribute("aria-pressed", "false");
    expect(heart()).toHaveAccessibleName(/\b3\b/);
  });

  it("44px target", () => {
    const { container, unmount } = render(
      <LikeButton remixId={REMIX} authorName="Priya" count={3} liked={false} signedIn returnTo="/remixes" />,
    );
    expect(heart().className).toMatch(TARGET_44);
    expect(heart().className).toMatch(WIDTH_44);
    for (const svg of container.querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
    unmount();
    render(<LikeButton remixId={REMIX} authorName="Priya" count={3} liked={false} signedIn={false} returnTo="/remixes" />);
    const link = screen.getByRole("link", { name: /sign in to like/i });
    expect(link.className).toMatch(TARGET_44);
    expect(link.className).toMatch(WIDTH_44);
  });
});
