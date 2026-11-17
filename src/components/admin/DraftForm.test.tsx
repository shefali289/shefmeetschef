import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Recipe } from "@/lib/types";
import DraftFormBase from "./DraftForm";

/*
 * Contract (review finding 8): DraftForm uses useActionState, so `action` is
 *   (prevState: DraftFormState, formData: FormData) => Promise<DraftFormState>
 * where DraftFormState = { errors?: Record<string, string> }. Returned errors render with
 * role="alert". Inputs carry maxLength matching the server limits. The save button reads
 * "Save changes" for live recipes and "Save draft" otherwise.
 */
type DraftFormState = { errors?: Record<string, string> };
type StateAction = (prev: DraftFormState, formData: FormData) => Promise<DraftFormState>;
const DraftForm = DraftFormBase as unknown as (props: { recipe: Recipe; action: StateAction }) => React.ReactElement;
const okAction = () => vi.fn<StateAction>(async () => ({}));

const recipe: Recipe = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "paneer-tikka",
  title: "Paneer Tika",
  description: "Smoky air-fryer paneer.",
  reel_url: "https://www.instagram.com/reel/ABC123/",
  youtube_url: null,
  cover_image_url: "https://cdninstagram.example/t/abc.jpg",
  source: "shef",
  ingredients: [
    { qty: 200, unit: "g", item: "paneer", note: null },
    { qty: 2, unit: "tbsp", item: "yoghurt", note: null },
  ],
  steps: [{ text: "Marinate the paneer." }, { text: "Air fry 12 minutes." }],
  base_servings: 2,
  prep_minutes: 10,
  cook_minutes: 12,
  cuisine: "indian",
  diet_tags: ["vegetarian"],
  allergens: ["milk"],
  categories: ["air-fryer"],
  status: "draft",
  published_at: null,
};

function formValues(fd: FormData): string[] {
  return [...fd.entries()].map(([, v]) => String(v));
}

describe("DraftForm", () => {
  it("edits title, ingredients, steps with labelled fields", async () => {
    const user = userEvent.setup();
    render(<DraftForm recipe={recipe} action={okAction()} />);

    const title = screen.getByLabelText(/^title$/i);
    expect(title).toHaveValue("Paneer Tika");
    await user.clear(title);
    await user.type(title, "Paneer Tikka");
    expect(title).toHaveValue("Paneer Tikka");

    expect(screen.getByLabelText(/ingredient 1 quantity/i)).toHaveValue(200);
    expect(screen.getByLabelText(/ingredient 1 unit/i)).toHaveValue("g");
    const item1 = screen.getByLabelText(/ingredient 1 item/i);
    expect(item1).toHaveValue("paneer");
    expect(screen.getByLabelText(/ingredient 2 item/i)).toHaveValue("yoghurt");
    await user.clear(item1);
    await user.type(item1, "paneer cubes");
    expect(item1).toHaveValue("paneer cubes");

    const step1 = screen.getByLabelText(/^step 1$/i);
    expect(step1).toHaveValue("Marinate the paneer.");
    expect(screen.getByLabelText(/^step 2$/i)).toHaveValue("Air fry 12 minutes.");
    await user.clear(step1);
    await user.type(step1, "Marinate overnight.");
    expect(step1).toHaveValue("Marinate overnight.");
  });

  it("Publish button submits", async () => {
    const user = userEvent.setup();
    const action = okAction();
    render(<DraftForm recipe={recipe} action={action} />);

    const title = screen.getByLabelText(/^title$/i);
    await user.clear(title);
    await user.type(title, "Paneer Tikka");
    const item1 = screen.getByLabelText(/ingredient 1 item/i);
    await user.clear(item1);
    await user.type(item1, "paneer cubes");
    const step1 = screen.getByLabelText(/^step 1$/i);
    await user.clear(step1);
    await user.type(step1, "Marinate overnight.");

    await user.click(screen.getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));

    const fd = action.mock.calls[0][1];
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get("id")).toBe(recipe.id);
    expect(fd.get("title")).toBe("Paneer Tikka");
    expect(fd.get("intent")).toBe("publish");
    // edited ingredient and step reach the server, however they are encoded
    const values = formValues(fd).join("\n");
    expect(values).toContain("paneer cubes");
    expect(values).toContain("Marinate overnight.");
  });

  it("inputs have maxLength matching the server limits", () => {
    render(<DraftForm recipe={recipe} action={okAction()} />);
    expect(screen.getByLabelText(/^title$/i)).toHaveAttribute("maxLength", "200");
    expect(screen.getByLabelText(/^description$/i)).toHaveAttribute("maxLength", "2000");
    expect(screen.getByLabelText(/ingredient 1 unit/i)).toHaveAttribute("maxLength", "40");
    expect(screen.getByLabelText(/ingredient 1 item/i)).toHaveAttribute("maxLength", "200");
    expect(screen.getByLabelText(/ingredient 1 note/i)).toHaveAttribute("maxLength", "200");
    expect(screen.getByLabelText(/^step 1$/i)).toHaveAttribute("maxLength", "2000");
  });

  it('save button reads "Save draft" for drafts and "Save changes" for live recipes', () => {
    const { unmount } = render(<DraftForm recipe={recipe} action={okAction()} />);
    expect(screen.getByRole("button", { name: /^save draft$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save changes$/i })).not.toBeInTheDocument();
    unmount();
    render(
      <DraftForm
        recipe={{ ...recipe, status: "live", published_at: "2026-11-01T00:00:00Z" }}
        action={okAction()}
      />,
    );
    expect(screen.getByRole("button", { name: /^save changes$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save draft$/i })).not.toBeInTheDocument();
  });

  it('shows field errors returned by the action with role="alert"', async () => {
    const user = userEvent.setup();
    const action = vi.fn<StateAction>(async () => ({
      errors: { title: "Title is required", ingredients: "Add at least one ingredient" },
    }));
    render(<DraftForm recipe={recipe} action={action} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^save draft$/i }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action.mock.calls[0][1].get("intent")).toBe("save");

    const alerts = await screen.findAllByRole("alert");
    const text = alerts.map((a) => a.textContent).join(" ");
    expect(text).toContain("Title is required");
    expect(text).toContain("Add at least one ingredient");
  });
});
