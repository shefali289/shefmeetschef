import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import type { RemixFormState } from "@/lib/remix/types";

/*
 * Contract (task 3 slice C extension of slice B's RemixForm; own file to avoid clashing):
 *   <RemixForm ... challenge={{ id, title } | null} />
 *   With a challenge (the open challenge's base recipe is this recipe), the form says
 *   "This remix enters <title>" with a link to /challenges/<id>, and the note
 *   "Entries may be featured in Shef's reel". Without one, neither shows.
 *   The prop is optional so slice B's callers keep compiling.
 */

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: vi.fn(() => ({ storage: { from: vi.fn(() => ({ upload: vi.fn() })) } })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/recipes/masala-chai/remix",
  useSearchParams: () => new URLSearchParams(),
}));

import RemixFormBase, { type RemixFormProps } from "./RemixForm";

type ChallengeProp = { challenge?: { id: string; title: string } | null };
const RemixForm = RemixFormBase as unknown as ComponentType<RemixFormProps & ChallengeProp>;

const USER = "b0000000-0000-4000-8000-000000000002";
const CHALLENGE = { id: "c2c2c2c2-0000-4000-8000-000000000002", title: "Chai, your way" };
const action = vi.fn(async (_p: RemixFormState, _fd: FormData): Promise<RemixFormState> => null);

describe("RemixForm and the weekly challenge", () => {
  it("on the base recipe the form says this remix enters the challenge", () => {
    render(<RemixForm slug="masala-chai" userId={USER} remaining={3} limit={5} action={action} challenge={CHALLENGE} />);
    expect(screen.getByText(/this remix enters/i)).toHaveTextContent(/Chai, your way/);
    expect(screen.getByRole("link", { name: /chai, your way/i })).toHaveAttribute("href", `/challenges/${CHALLENGE.id}`);
    expect(screen.getByText(/entries may be featured in Shef['’]s reel/i)).toBeInTheDocument();
    // the form itself is still there
    expect(screen.getByLabelText(/photo/i)).toBeInTheDocument();
  });

  it("without a challenge there is no entry or featuring note", () => {
    render(<RemixForm slug="masala-chai" userId={USER} remaining={3} limit={5} action={action} challenge={null} />);
    expect(screen.queryByText(/this remix enters/i)).toBeNull();
    expect(screen.queryByText(/may be featured/i)).toBeNull();
  });
});
