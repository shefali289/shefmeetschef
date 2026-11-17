import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AuthButton from "./AuthButton";

function signOutControl() {
  return (
    screen.queryByRole("button", { name: /sign out/i }) ??
    screen.queryByRole("link", { name: /sign out/i })
  );
}

describe("AuthButton", () => {
  it("renders nothing when Supabase is not configured", () => {
    const { container } = render(<AuthButton configured={false} user={null} />);
    expect(container).toBeEmptyDOMElement();
    const again = render(<AuthButton configured={false} user={{ email: "a@b.co" }} />);
    expect(again.container).toBeEmptyDOMElement();
  });

  it("shows Sign in when signed out, Sign out when signed in", () => {
    const { unmount } = render(<AuthButton configured user={null} />);
    const signIn = screen.getByRole("link", { name: /sign in/i });
    expect(signIn).toHaveAttribute("href", expect.stringMatching(/^\/sign-in/));
    expect(signOutControl()).toBeNull();
    unmount();

    render(<AuthButton configured user={{ email: "shef@example.com" }} />);
    expect(signOutControl()).not.toBeNull();
    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
  });
});
