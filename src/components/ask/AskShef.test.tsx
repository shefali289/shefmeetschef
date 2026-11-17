import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AskResult, ShefVersion } from "@/lib/ask-shef/types";
import AskShef, { type AskShefProps } from "./AskShef";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/recipes/masala-chai",
  useSearchParams: () => new URLSearchParams(),
}));

const ORIGINAL: ShefVersion = {
  ingredients: [{ qty: 1, unit: "cup", item: "milk" }],
  steps: [{ text: "Boil." }],
  diet_tags: ["vegetarian"],
};

const ok = (over: Partial<Extract<AskResult, { status: "ok" }>> = {}): AskResult => ({
  status: "ok",
  question: "Oat milk?",
  answer: "Oat milk works a treat. Happy cooking!",
  shefVersion: null,
  remaining: 6,
  limit: 10,
  ...over,
});

function setup(over: Partial<AskShefProps> = {}) {
  const action = vi.fn(async (_prev: AskResult | null, _fd: FormData): Promise<AskResult> => ok());
  const props: AskShefProps = {
    slug: "masala-chai",
    configured: true,
    signedIn: true,
    remaining: 7,
    limit: 10,
    original: ORIGINAL,
    action,
    ...over,
  };
  render(<AskShef {...props} />);
  return { action: props.action as typeof action, user: userEvent.setup() };
}

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  const box = screen.getByRole("textbox", { name: /question|ask shef/i });
  await user.clear(box);
  await user.type(box, text);
  await user.click(screen.getByRole("button", { name: /ask shef/i }));
}

describe("AskShef", () => {
  it("signed-out shows Sign in to ask Shef link", () => {
    const { action } = setup({ signedIn: false });
    const link = screen.getByRole("link", { name: /sign in to ask shef/i });
    const href = link.getAttribute("href")!;
    expect(href.startsWith("/sign-in")).toBe(true);
    expect(new URLSearchParams(href.split("?")[1]).get("next")).toBe("/recipes/masala-chai");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(action).not.toHaveBeenCalled();
  });

  it("not configured shows not set up yet and no form", () => {
    setup({ configured: false, signedIn: false });
    expect(screen.getByText(/sign in to ask shef/i)).toBeInTheDocument();
    expect(screen.getByText(/not set up yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /ask shef/i })).toBeNull();
  });

  it("shows 7 of 10 questions left today", async () => {
    const { user } = setup();
    expect(screen.getByText(/7 of 10 questions left today/)).toBeInTheDocument();
    await ask(user, "Oat milk?");
    // the counter follows the server's count after each answer
    expect(await screen.findByText(/6 of 10 questions left today/)).toBeInTheDocument();
  });

  it("textarea has a label and maxLength 500", () => {
    setup();
    const box = screen.getByRole("textbox", { name: /question|ask shef/i });
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveAttribute("maxLength", "500");
    expect(box).toHaveAttribute("name", "question");
    expect(box).toBeRequired();
    const button = screen.getByRole("button", { name: /ask shef/i });
    expect(button.className).toMatch(/min-h-11|min-h-\[44px\]|h-11|h-12/);
  });

  it("sends the slug, never the recipe text", async () => {
    const { action, user } = setup();
    await ask(user, "Oat milk?");
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const fd = action.mock.calls[0][1];
    expect(fd.get("slug")).toBe("masala-chai");
    expect(fd.get("question")).toBe("Oat milk?");
    expect(fd.get("recipe")).toBeNull();
    expect(fd.get("ingredients")).toBeNull();
  });

  it("answer is rendered as text, not HTML", async () => {
    const evil = '<img src=x onerror="alert(1)"> Use <b>coconut</b> milk';
    const { action, user } = setup();
    action.mockResolvedValueOnce(ok({ answer: evil }));
    await ask(user, "Dairy free?");
    expect(await screen.findByText(evil)).toBeInTheDocument();
    expect(document.body.querySelector("img")).toBeNull();
    expect(document.body.querySelector("b")).toBeNull();
  });

  it("allergy disclaimer appears under every answer", async () => {
    const { action, user } = setup();
    action
      .mockResolvedValueOnce(ok({ question: "Oat milk?", answer: "First answer.", remaining: 6 }))
      .mockResolvedValueOnce(ok({ question: "Less sugar?", answer: "Second answer.", remaining: 5 }));
    const disclaimers = () => screen.queryAllByText(/allerg/i).length;
    const before = disclaimers();
    await ask(user, "Oat milk?");
    await screen.findByText("First answer.");
    expect(disclaimers()).toBe(before + 1);
    await ask(user, "Less sugar?");
    await screen.findByText("Second answer.");
    expect(disclaimers()).toBe(before + 2);
  });

  it("sends the last 3 questions and answers with the next question", async () => {
    const { action, user } = setup({ remaining: 9 });
    let n = 0;
    action.mockImplementation(async (_p, fd) => {
      n++;
      return ok({ question: String(fd.get("question")), answer: `answer-${n}`, remaining: 9 - n });
    });
    for (const q of ["q1", "q2", "q3", "q4"]) {
      await ask(user, q);
      await screen.findByText(`answer-${["q1", "q2", "q3", "q4"].indexOf(q) + 1}`);
    }
    await ask(user, "q5");
    await waitFor(() => expect(action).toHaveBeenCalledTimes(5));
    const first = action.mock.calls[0][1].get("history");
    expect(first === null || JSON.parse(String(first)).length === 0).toBe(true);
    const history = JSON.parse(String(action.mock.calls[4][1].get("history")));
    expect(history).toEqual([
      { question: "q2", answer: "answer-2" },
      { question: "q3", answer: "answer-3" },
      { question: "q4", answer: "answer-4" },
    ]);
  });

  it("shows Shef's version toggle when the answer changes the recipe", async () => {
    const { action, user } = setup();
    action.mockResolvedValueOnce(
      ok({
        answer: "Here's a vegan one.",
        shefVersion: {
          ingredients: [{ qty: 1, unit: "cup", item: "oat milk" }],
          steps: [{ text: "Simmer." }],
          diet_tags: ["vegan"],
        },
      }),
    );
    await ask(user, "Make it vegan");
    expect(await screen.findByRole("button", { name: /shef.s version/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("limit message replaces the form", async () => {
    const { action, user } = setup({ remaining: 1 });
    action.mockResolvedValueOnce({
      status: "limit",
      message: "That's all your questions for today. 0 of 10 questions left today.",
      remaining: 0,
      limit: 10,
    });
    await ask(user, "One more?");
    expect(await screen.findByText(/0 of 10 questions left today/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("starts with the limit message when no questions are left", () => {
    setup({ remaining: 0 });
    expect(screen.getByText(/0 of 10 questions left today/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("one status region stays mounted and announces thinking, then the newest answer", async () => {
    const { action, user } = setup();
    // present before any ask, so screen readers already track it when content changes
    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(1);
    const region = regions[0];
    expect(region).not.toHaveTextContent(/shef is thinking/i);

    let resolveFirst!: (r: AskResult) => void;
    action
      .mockImplementationOnce(() => new Promise<AskResult>((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(ok({ question: "Less sugar?", answer: "Second answer.", remaining: 5 }));

    await ask(user, "Oat milk?");
    // pending: the same element says Shef is thinking (not a new region mounted for it)
    await waitFor(() => expect(region).toHaveTextContent(/shef is thinking/i));
    expect(screen.getAllByRole("status")).toEqual([region]);

    resolveFirst(ok({ answer: "First answer.", remaining: 6 }));
    await waitFor(() => expect(region).toHaveTextContent("First answer."));
    expect(region).not.toHaveTextContent(/shef is thinking/i);
    expect(region.isConnected).toBe(true);
    expect(screen.getAllByRole("status")).toEqual([region]);

    await ask(user, "Less sugar?");
    await waitFor(() => expect(region).toHaveTextContent("Second answer."));
    // only the newest answer is announced
    expect(region).not.toHaveTextContent("First answer.");
    expect(screen.getAllByRole("status")).toEqual([region]);
  });

  it("errors are announced", async () => {
    const { action, user } = setup();
    action.mockResolvedValueOnce({ status: "error", message: "Shef is busy, please try again." });
    await ask(user, "Hello?");
    expect(await screen.findByRole("alert")).toHaveTextContent(/try again/i);
    // the form stays so they can try again
    expect(screen.getByRole("textbox", { name: /question|ask shef/i })).toBeInTheDocument();
  });
});
