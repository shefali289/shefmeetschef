import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AddReelFormState } from "@/lib/outside/add-reel";
import AddReelForm from "./AddReelForm";

function setup(remaining = 3, result: AddReelFormState = null) {
  const action = vi.fn(async (_p: AddReelFormState, _fd: FormData): Promise<AddReelFormState> => result);
  render(<AddReelForm remaining={remaining} limit={5} action={action} />);
  return { action, user: userEvent.setup() };
}

describe("AddReelForm", () => {
  it("labelled URL and caption fields", () => {
    setup();
    const url = screen.getByLabelText(/reel link|instagram link|link/i);
    expect(url.tagName).toBe("INPUT");
    expect(url).toHaveAttribute("type", "url");
    expect(url).toHaveAttribute("name", "url");
    expect(url).toBeRequired();
    const caption = screen.getByLabelText(/caption/i);
    expect(caption.tagName).toBe("TEXTAREA");
    expect(caption).toHaveAttribute("name", "caption");
    expect(caption).toHaveAttribute("maxLength", "2200");
    expect(caption).toBeRequired();
    const button = screen.getByRole("button", { name: /make|add|turn/i });
    expect(button.className).toMatch(/min-h-11|min-h-\[44px\]|h-11|h-12/);
  });

  it("shows 3 of 5 left this month", () => {
    setup(3);
    expect(screen.getByText(/3 of 5 left this month/)).toBeInTheDocument();
  });

  it("errors are announced (role=alert)", async () => {
    const { action, user } = setup(3, {
      status: "invalid",
      errors: { url: "Paste an Instagram reel or post link." },
    });
    await user.type(screen.getByLabelText(/reel link|instagram link|link/i), "https://www.instagram.com/reel/ABC123/");
    await user.type(screen.getByLabelText(/caption/i), "Some caption");
    await user.click(screen.getByRole("button", { name: /make|add|turn/i }));
    expect(action).toHaveBeenCalledTimes(1);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Paste an Instagram reel or post link.");
  });

  it("no recipe found is announced and the form stays", async () => {
    const { user } = setup(3, {
      status: "no-recipe",
      message: "No recipe found in that caption. That didn't use up a reel.",
      remaining: 3,
    });
    await user.type(screen.getByLabelText(/reel link|instagram link|link/i), "https://www.instagram.com/reel/ABC123/");
    await user.type(screen.getByLabelText(/caption/i), "Sunset");
    await user.click(screen.getByRole("button", { name: /make|add|turn/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no recipe found in that caption/i);
    expect(screen.getByLabelText(/caption/i)).toBeInTheDocument();
  });

  it("no reels left shows the limit message instead of the form", () => {
    setup(0);
    expect(screen.getByText(/0 of 5 left this month/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/caption/i)).toBeNull();
  });
});
