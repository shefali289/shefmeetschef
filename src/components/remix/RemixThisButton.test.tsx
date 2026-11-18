import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RemixThisButton from "./RemixThisButton";

/*
 * Contract: <RemixThisButton slug signedIn configured /> (a link, no client state).
 * - Signed in: link "Remix this" to /recipes/<slug>/remix.
 * - Signed out: link (named "... remix this ...") to /sign-in?next=<encoded /recipes/<slug>/remix>.
 * - Not configured: still a keyboard-reachable "Remix this" link (its page explains), described by
 *   the visible note "Remixes are not set up yet".
 * - 44px tap target in every state.
 */

const TARGET_44 = /(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/;
const NEXT = `/sign-in?next=${encodeURIComponent("/recipes/masala-chai/remix")}`;

describe("RemixThisButton", () => {
  it("signed-in links to /recipes/<slug>/remix", () => {
    render(<RemixThisButton slug="masala-chai" signedIn configured />);
    const link = screen.getByRole("link", { name: /remix this/i });
    expect(link).toHaveAttribute("href", "/recipes/masala-chai/remix");
    expect(screen.queryByText(/not set up yet/i)).toBeNull();
  });

  it("signed-out links to sign-in with next", () => {
    render(<RemixThisButton slug="masala-chai" signedIn={false} configured />);
    const link = screen.getByRole("link", { name: /remix this/i });
    expect(link).toHaveAttribute("href", NEXT);
    expect(screen.queryByText(/not set up yet/i)).toBeNull();
  });

  it("not configured says Remixes are not set up yet", () => {
    render(<RemixThisButton slug="masala-chai" signedIn={false} configured={false} />);
    expect(screen.getByText(/Remixes are not set up yet/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /remix this/i });
    expect(link).toHaveAccessibleDescription(/not set up yet/i);
    // never a sign-in bounce when sign-in itself is not set up
    expect(link.getAttribute("href")).not.toMatch(/^\/sign-in/);
  });

  it("44px target", () => {
    for (const props of [
      { signedIn: true, configured: true },
      { signedIn: false, configured: true },
      { signedIn: false, configured: false },
    ]) {
      const { unmount } = render(<RemixThisButton slug="masala-chai" {...props} />);
      expect(screen.getByRole("link", { name: /remix this/i }).className).toMatch(TARGET_44);
      unmount();
    }
  });
});
