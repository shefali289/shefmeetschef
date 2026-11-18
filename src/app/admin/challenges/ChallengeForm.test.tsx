import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChallengeFormState } from "@/lib/challenges/types";
import ChallengeForm, { type ChallengeFormRecipe } from "./ChallengeForm";

/*
 * Contract: <ChallengeForm recipes defaults? action /> ("use client", useActionState).
 * - Labelled controls: Title (name title, required, maxLength 200), Description (textarea,
 *   name description, maxLength 2000), Base recipe (select, name base_recipe_id, required),
 *   Start date and End date (type date, names starts_on / ends_on, required).
 * - The select offers live Shef recipes only (value = recipe id), whatever it is given.
 * - Dates default to `defaults`, else defaultChallengeWeek() (Monday to Sunday NZ).
 * - Submit "Create challenge" (44px). Errors from the action show next to their field and
 *   errors.form in role="alert"; ok shows "Challenge created" in a status region.
 */

const RECIPES: ChallengeFormRecipe[] = [
  { id: "11111111-1111-4111-8111-111111111111", title: "Masala Chai", source: "shef", status: "live" },
  { id: "22222222-2222-4222-8222-222222222222", title: "Paneer Tikka", source: "shef", status: "live" },
  { id: "33333333-3333-4333-8333-333333333333", title: "Secret Curry", source: "shef", status: "draft" },
  { id: "44444444-4444-4444-8444-444444444444", title: "Nani's Dal", source: "outside", status: "live" },
];

const TARGET_44 = /(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/;

function setup(result: ChallengeFormState = { ok: true, id: "c" }, props: Partial<Parameters<typeof ChallengeForm>[0]> = {}) {
  const action = vi.fn(async (_p: ChallengeFormState, _fd: FormData): Promise<ChallengeFormState> => result);
  render(<ChallengeForm recipes={RECIPES} action={action} {...props} />);
  return { action, user: userEvent.setup() };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ChallengeForm", () => {
  it("fields are labelled", () => {
    setup(null, { defaults: { startsOn: "2026-11-23", endsOn: "2026-11-29" } });
    const title = screen.getByLabelText(/title/i) as HTMLInputElement;
    expect(title).toHaveAttribute("name", "title");
    expect(title).toBeRequired();
    expect(title.maxLength).toBe(200);

    const description = screen.getByLabelText(/description/i) as HTMLTextAreaElement;
    expect(description.tagName).toBe("TEXTAREA");
    expect(description).toHaveAttribute("name", "description");
    expect(description.maxLength).toBe(2000);

    const base = screen.getByLabelText(/base recipe/i) as HTMLSelectElement;
    expect(base.tagName).toBe("SELECT");
    expect(base).toHaveAttribute("name", "base_recipe_id");
    expect(base).toBeRequired();

    const start = screen.getByLabelText(/start/i) as HTMLInputElement;
    const end = screen.getByLabelText(/end/i) as HTMLInputElement;
    expect(start).toHaveAttribute("type", "date");
    expect(start).toHaveAttribute("name", "starts_on");
    expect(end).toHaveAttribute("type", "date");
    expect(end).toHaveAttribute("name", "ends_on");

    const submit = screen.getByRole("button", { name: /create challenge/i });
    expect(submit.className).toMatch(TARGET_44);
  });

  it("base recipe select lists live Shef recipes only", () => {
    setup(null);
    const base = screen.getByLabelText(/base recipe/i) as HTMLSelectElement;
    const options = Array.from(base.options).filter((o) => o.value !== "");
    expect(options.map((o) => o.textContent)).toEqual(["Masala Chai", "Paneer Tikka"]);
    expect(options.map((o) => o.value)).toEqual([RECIPES[0].id, RECIPES[1].id]);
    expect(base.textContent).not.toMatch(/Secret Curry|Nani/);
  });

  it("dates default to Monday to Sunday NZ", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T01:00:00Z")); // Wednesday in NZ
    const { unmount } = render(<ChallengeForm recipes={RECIPES} action={vi.fn(async () => null)} />);
    expect(screen.getByLabelText(/start/i)).toHaveValue("2026-11-23");
    expect(screen.getByLabelText(/end/i)).toHaveValue("2026-11-29");
    unmount();

    // explicit defaults win
    render(<ChallengeForm recipes={RECIPES} action={vi.fn(async () => null)} defaults={{ startsOn: "2026-11-30", endsOn: "2026-12-06" }} />);
    expect(screen.getByLabelText(/start/i)).toHaveValue("2026-11-30");
    expect(screen.getByLabelText(/end/i)).toHaveValue("2026-12-06");
  });

  it("sends the fields to the action and shows its errors", async () => {
    const { action, user } = setup({ errors: { starts_on: "These dates overlap another challenge.", form: "Please check the form." } }, {
      defaults: { startsOn: "2026-11-23", endsOn: "2026-11-29" },
    });
    await user.type(screen.getByLabelText(/title/i), "Chai, your way");
    await user.selectOptions(screen.getByLabelText(/base recipe/i), RECIPES[1].id);
    await user.click(screen.getByRole("button", { name: /create challenge/i }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const fd = action.mock.calls[0][1];
    expect(fd.get("title")).toBe("Chai, your way");
    expect(fd.get("base_recipe_id")).toBe(RECIPES[1].id);
    expect(fd.get("starts_on")).toBe("2026-11-23");
    expect(fd.get("ends_on")).toBe("2026-11-29");

    expect(await screen.findByText(/overlap another challenge/i)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/please check the form/i);
  });

  it("says Challenge created after a successful save", async () => {
    const { user } = setup({ ok: true, id: "c2c2c2c2-0000-4000-8000-000000000002" }, { defaults: { startsOn: "2026-11-23", endsOn: "2026-11-29" } });
    await user.type(screen.getByLabelText(/title/i), "Chai, your way");
    await user.selectOptions(screen.getByLabelText(/base recipe/i), RECIPES[0].id);
    await user.click(screen.getByRole("button", { name: /create challenge/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/challenge created/i);
  });
});

/* ---------- slice C review (N10): focus after a failed save ---------- */
// Pinned option: focus moves to the first invalid field in form order (not an alert summary).

describe("ChallengeForm focus after a failed save (N10)", () => {
  async function failWith(errors: NonNullable<ChallengeFormState>["errors"]) {
    const { user } = setup({ errors }, { defaults: { startsOn: "2026-11-23", endsOn: "2026-11-29" } });
    await user.type(screen.getByLabelText(/title/i), "Chai, your way");
    await user.selectOptions(screen.getByLabelText(/base recipe/i), RECIPES[0].id);
    await user.click(screen.getByRole("button", { name: /create challenge/i }));
  }

  it("moves focus to the first invalid field", async () => {
    await failWith({ ends_on: "End on or after the start date.", starts_on: "These dates overlap another challenge." });
    const start = screen.getByLabelText(/start/i);
    await waitFor(() => expect(start).toHaveFocus());
    expect(start).toHaveAttribute("aria-invalid", "true");
  });

  it("uses form order, not the order of the errors", async () => {
    await failWith({ ends_on: "End on or after the start date.", description: "Keep it to 2000 characters." });
    await waitFor(() => expect(screen.getByLabelText(/description/i)).toHaveFocus());
  });

  it("the title is focused when it is the invalid one", async () => {
    await failWith({ title: "Give it a title." });
    await waitFor(() => expect(screen.getByLabelText(/title/i)).toHaveFocus());
  });
});
