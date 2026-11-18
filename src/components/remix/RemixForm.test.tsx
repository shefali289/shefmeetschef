import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RemixFormState } from "@/lib/remix/types";

/*
 * Contract: <RemixForm slug userId remaining limit? action /> ("use client").
 * - A labelled photo file input (accept image/jpeg, image/png, image/webp; required) and a
 *   labelled "What you changed" textarea (name "changes", maxLength 2000, required).
 * - Shows "<n> of 5 remixes left today"; with none left (or a limit result) the limit message
 *   replaces the form.
 * - Prefills "what you changed" once from Shef's version (takeRemixPrefill(slug)), which clears it.
 * - On submit: checks the file (checkPhotoFile), prepares it (preparePhoto: 1600 px, re-encoded),
 *   uploads it with the browser client to remix-photos at photoPathFor(userId, type) (never
 *   upsert), THEN calls action with slug, photo_path and changes. The file itself is never sent
 *   to the server action.
 * - Errors (bad file, failed upload, invalid/error results) are announced with role="alert";
 *   a pending result says "Thanks! Waiting for a quick check" in a status region.
 */

const { upload, order, preparePhoto } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    upload: vi.fn(async (path: string, _body: unknown, _opts?: unknown) => {
      order.push("upload");
      return { data: { path }, error: null as { message: string } | null };
    }),
    preparePhoto: vi.fn(async (file: File) => {
      order.push("prepare");
      return file as Blob;
    }),
  };
});
const storageFrom = vi.fn((_bucket: string) => ({ upload }));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: vi.fn(() => ({ storage: { from: storageFrom } })),
}));
vi.mock("@/lib/remix/prepare-photo", async (orig) => ({
  ...(await orig<typeof import("@/lib/remix/prepare-photo")>()),
  preparePhoto,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/recipes/masala-chai/remix",
  useSearchParams: () => new URLSearchParams(),
}));

import { saveRemixPrefill, takeRemixPrefill } from "@/lib/remix/changes";
import RemixForm from "./RemixForm";

const USER = "b0000000-0000-4000-8000-000000000002";
const OWN_PATH = new RegExp(`^${USER}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp)$`);
const TARGET_44 = /(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/;

const jpeg = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])], "chai.jpg", { type: "image/jpeg" });

function setup(remaining = 3, result: RemixFormState = null) {
  const action = vi.fn(async (_p: RemixFormState, _fd: FormData): Promise<RemixFormState> => {
    order.push("action");
    return result;
  });
  render(<RemixForm slug="masala-chai" userId={USER} remaining={remaining} limit={5} action={action} />);
  // applyAccept: false so a wrong file type reaches the component's own check
  return { action, user: userEvent.setup({ applyAccept: false }) };
}

const photoInput = () => screen.getByLabelText(/photo/i) as HTMLInputElement;
const changesBox = () => screen.getByRole("textbox", { name: /what (you|I) changed/i }) as HTMLTextAreaElement;
const submit = () => screen.getByRole("button", { name: /post|share/i });

async function fillAndPost(user: ReturnType<typeof userEvent.setup>, file: File = jpeg(), text = "Oat milk, less sugar.") {
  await user.upload(photoInput(), file);
  await user.clear(changesBox());
  await user.type(changesBox(), text);
  await user.click(submit());
}

beforeEach(() => {
  order.length = 0;
  upload.mockClear();
  storageFrom.mockClear();
  preparePhoto.mockClear();
});
afterEach(() => sessionStorage.clear());

describe("RemixForm", () => {
  it("photo input is labelled and accepts JPEG, PNG and WebP", () => {
    setup();
    const input = photoInput();
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toBeRequired();
    const accept = (input.getAttribute("accept") ?? "").split(",").map((s) => s.trim());
    expect([...accept].sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(input.multiple).toBe(false);
    expect(submit().className).toMatch(TARGET_44);
  });

  it("what I changed has a label and maxLength 2000", () => {
    setup();
    const box = changesBox();
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveAttribute("name", "changes");
    expect(box).toHaveAttribute("maxLength", "2000");
    expect(box).toBeRequired();
  });

  it("shows 3 of 5 remixes left today", () => {
    setup(3);
    expect(screen.getByText(/3 of 5 remixes left today/)).toBeInTheDocument();
  });

  it("limit message replaces the form", async () => {
    setup(0);
    expect(screen.getByText(/0 of 5 remixes left today/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/photo/i)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("a limit result from the server replaces the form", async () => {
    const { user } = setup(1, {
      status: "limit",
      message: "That's all your remixes for today, come back tomorrow. 0 of 5 remixes left today.",
      remaining: 0,
      limit: 5,
    });
    await fillAndPost(user);
    expect(await screen.findByText(/0 of 5 remixes left today/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/photo/i)).toBeNull();
  });

  it("prefills once from Shef's version and clears it", () => {
    saveRemixPrefill("masala-chai", "Swapped milk for oat milk.\nLess sugar.");
    const { unmount } = render(<RemixForm slug="masala-chai" userId={USER} remaining={3} limit={5} action={vi.fn()} />);
    expect(changesBox().value).toBe("Swapped milk for oat milk.\nLess sugar.");
    // read once: it is gone from sessionStorage, and a fresh form starts empty
    expect(takeRemixPrefill("masala-chai")).toBeNull();
    unmount();
    render(<RemixForm slug="masala-chai" userId={USER} remaining={3} limit={5} action={vi.fn()} />);
    expect(changesBox().value).toBe("");
  });

  it("a prefill for another recipe is not used", () => {
    saveRemixPrefill("dal-makhani", "Less cream.");
    render(<RemixForm slug="masala-chai" userId={USER} remaining={3} limit={5} action={vi.fn()} />);
    expect(changesBox().value).toBe("");
  });

  it("uploads to the user's folder before calling the action", async () => {
    const { action, user } = setup(3, {
      status: "pending",
      id: "r1",
      message: "Thanks! Waiting for a quick check",
      remaining: 2,
      limit: 5,
    });
    const file = jpeg();
    await fillAndPost(user, file);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));

    expect(preparePhoto).toHaveBeenCalledTimes(1);
    expect(preparePhoto.mock.calls[0][0]).toBe(file);
    expect(storageFrom).toHaveBeenCalledWith("remix-photos");
    expect(upload).toHaveBeenCalledTimes(1);
    const [path, body, opts] = upload.mock.calls[0];
    expect(path).toMatch(OWN_PATH);
    expect(body).toBe(file); // what preparePhoto returned
    expect((opts as { upsert?: boolean } | undefined)?.upsert).not.toBe(true);
    expect(order).toEqual(["prepare", "upload", "action"]);

    const fd = action.mock.calls[0][1];
    expect(fd.get("slug")).toBe("masala-chai");
    expect(fd.get("photo_path")).toBe(path);
    expect(fd.get("changes")).toBe("Oat milk, less sugar.");
    // the photo itself never goes through the server action (body size limits)
    for (const [, value] of fd.entries()) expect(value).not.toBeInstanceOf(Blob);

    expect(await screen.findByRole("status")).toHaveTextContent(/Thanks! Waiting for a quick check/);
    expect(screen.getByText(/2 of 5 remixes left today/)).toBeInTheDocument();
  });

  it("errors are announced (role=alert)", async () => {
    // a file that is not a photo is refused before any upload
    const first = setup(3);
    await fillAndPost(first.user, new File(["GIF89a"], "cat.gif", { type: "image/gif" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/JPEG|PNG|WebP/);
    expect(upload).not.toHaveBeenCalled();
    expect(first.action).not.toHaveBeenCalled();
  });

  it("a failed upload is announced and the action is not called", async () => {
    upload.mockImplementationOnce(async () => ({ data: null as unknown as { path: string }, error: { message: "Payload too large" } }));
    const { action, user } = setup(3);
    await fillAndPost(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/try again|couldn[’']t upload|could not upload/i);
    expect(action).not.toHaveBeenCalled();
  });

  it("server errors are announced and the text is kept", async () => {
    const { user } = setup(3, { status: "invalid", errors: { changes: "Tell us what you changed (up to 2000 characters)." } });
    await fillAndPost(user, jpeg(), "x");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Tell us what you changed/);
    expect(changesBox().value).toBe("x");
  });

  it("a banned result is announced", async () => {
    const { user } = setup(3, { status: "banned", message: "Sorry, you can't post remixes right now." });
    await fillAndPost(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't post/);
  });

  /* ---------- slice B review finding B2 ---------- */
  /** The focused element: the limit box, with tabIndex -1, inside the one persistent status region. */
  function expectFocusedLimitBox(text: RegExp) {
    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(1);
    const region = regions[0];
    expect(region).toHaveTextContent(text);
    const focused = document.activeElement as HTMLElement | null;
    expect(focused).not.toBe(document.body);
    expect(focused).toHaveTextContent(text);
    expect(focused).toHaveAttribute("tabindex", "-1");
    expect(region === focused || region.contains(focused)).toBe(true);
    return region;
  }

  it("B2: a limit result is said in the status region and focus moves to the limit box", async () => {
    const { user } = setup(1, {
      status: "limit",
      message: "That's all your remixes for today, come back tomorrow. 0 of 5 remixes left today.",
      remaining: 0,
      limit: 5,
    });
    const regionBefore = screen.getByRole("status");
    await fillAndPost(user);
    await screen.findAllByText(/0 of 5 remixes left today/);
    await waitFor(() => expectFocusedLimitBox(/0 of 5 remixes left today/));
    // the same region element stayed mounted, so screen readers hear the change
    expect(screen.getByRole("status")).toBe(regionBefore);
    expect(screen.queryByLabelText(/photo/i)).toBeNull();
  });

  it("B2: a post that uses the last remix shows thanks and the limit in the status region and focuses it", async () => {
    const { user } = setup(1, {
      status: "pending",
      id: "r9",
      message: "Thanks! Waiting for a quick check",
      remaining: 0,
      limit: 5,
    });
    const regionBefore = screen.getByRole("status");
    await fillAndPost(user);
    await screen.findAllByText(/Thanks! Waiting for a quick check/);
    await waitFor(() => expectFocusedLimitBox(/0 of 5 remixes left today/));
    const region = screen.getByRole("status");
    expect(region).toBe(regionBefore);
    expect(region).toHaveTextContent(/Thanks! Waiting for a quick check/);
    expect(screen.queryByLabelText(/photo/i)).toBeNull();
  });
});

