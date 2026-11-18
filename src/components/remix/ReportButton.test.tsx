import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * Contract: <ReportButton remixId authorName signedIn own returnTo /> ("use client"), shown on
 * approved remixes only (RemixCard decides).
 * - own: renders nothing (you cannot report your own remix).
 * - Signed out: a "Sign in to report" link to /sign-in?next=<encoded returnTo>.
 * - Signed in: a "Report" button (accessible name mentions the author). Pressing it opens an inline
 *   form (no browser dialog): a labelled optional reason textarea ("Reason (optional)",
 *   maxLength 300), a "Send report" confirm button and "Cancel". Focus moves into the form.
 *   Nothing is posted until "Send report". Posts remix_id, reason and return_to to reportRemix
 *   from @/app/remixes/report-actions.
 * - After a report (or "already reported"): "Reported, thanks" in a role="status" region and the
 *   Report button is gone. Errors are announced (role="alert") and the form stays.
 * - Every control is a 44px target.
 */

const { reportRemix } = vi.hoisted(() => ({
  reportRemix: vi.fn(async (_prev: unknown, _fd: FormData) => ({ ok: true, message: "Reported, thanks. Shef's team will take a look." }) as {
    ok?: boolean;
    message?: string;
    error?: string;
  }),
}));
vi.mock("@/app/remixes/report-actions", () => ({ reportRemix }));

import ReportButton from "./ReportButton";

const REMIX = "33333333-3333-4333-8333-333333333333";
const TARGET_44 = /(^|\s)(min-h|h|size)-(1[1-9]|[2-9]\d)(\s|$)/;

const renderSignedIn = () =>
  render(<ReportButton remixId={REMIX} authorName="Priya" signedIn own={false} returnTo="/recipes/masala-chai" />);

beforeEach(() => {
  reportRemix.mockClear();
});

describe("ReportButton", () => {
  it("Report opens a labelled optional reason and a confirm button", async () => {
    const user = userEvent.setup();
    renderSignedIn();
    const report = screen.getByRole("button", { name: /report/i });
    expect(report).toHaveAccessibleName(/Priya/);
    expect(screen.queryByLabelText(/reason/i)).toBeNull();

    await user.click(report);
    const reason = screen.getByLabelText(/reason \(optional\)/i);
    expect(reason.tagName).toBe("TEXTAREA");
    expect(reason).toHaveAttribute("maxLength", "300");
    expect(reason).not.toBeRequired();
    expect(screen.getByRole("button", { name: /send report/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(reportRemix).not.toHaveBeenCalled(); // opening is not reporting
    // keyboard users land in the form
    expect(document.activeElement === reason || document.activeElement === screen.getByRole("button", { name: /send report/i })).toBe(true);

    // cancel closes it without posting
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByLabelText(/reason/i)).toBeNull();
    expect(reportRemix).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /report/i })).toBeInTheDocument();
  });

  it("after reporting it says Reported, thanks", async () => {
    const user = userEvent.setup();
    renderSignedIn();
    await user.click(screen.getByRole("button", { name: /report/i }));
    await user.type(screen.getByLabelText(/reason \(optional\)/i), "Has a link to a shop");
    await user.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() => expect(reportRemix).toHaveBeenCalledTimes(1));
    const fd = reportRemix.mock.calls[0][1];
    expect(fd.get("remix_id")).toBe(REMIX);
    expect(fd.get("reason")).toBe("Has a link to a shop");
    expect(fd.get("return_to")).toBe("/recipes/masala-chai");
    expect(await screen.findByRole("status")).toHaveTextContent(/reported, thanks/i);
    expect(screen.queryByRole("button", { name: /^report/i })).toBeNull();
  });

  it("the reason can be left empty", async () => {
    const user = userEvent.setup();
    renderSignedIn();
    await user.click(screen.getByRole("button", { name: /report/i }));
    await user.click(screen.getByRole("button", { name: /send report/i }));
    await waitFor(() => expect(reportRemix).toHaveBeenCalledTimes(1));
    expect(reportRemix.mock.calls[0][1].get("reason") ?? "").toBe("");
  });

  it("an error is announced and the form stays", async () => {
    reportRemix.mockImplementationOnce(async () => ({ error: "You can't report this remix right now." }));
    const user = userEvent.setup();
    renderSignedIn();
    await user.click(screen.getByRole("button", { name: /report/i }));
    await user.click(screen.getByRole("button", { name: /send report/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't report this remix/i);
    expect(screen.getByRole("button", { name: /send report/i })).toBeInTheDocument();
  });

  it("not shown on own remixes and shows a sign-in link when signed out", () => {
    const { container, unmount } = render(
      <ReportButton remixId={REMIX} authorName="You" signedIn own returnTo="/recipes/masala-chai" />,
    );
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
    unmount();

    render(<ReportButton remixId={REMIX} authorName="Priya" signedIn={false} own={false} returnTo="/recipes/masala-chai" />);
    expect(screen.queryByRole("button")).toBeNull();
    const link = screen.getByRole("link", { name: /sign in to report/i });
    expect(link).toHaveAttribute("href", `/sign-in?next=${encodeURIComponent("/recipes/masala-chai")}`);
  });

  it("44px target", async () => {
    const user = userEvent.setup();
    renderSignedIn();
    const report = screen.getByRole("button", { name: /report/i });
    expect(report.className).toMatch(TARGET_44);
    await user.click(report);
    for (const name of [/send report/i, /cancel/i]) expect(screen.getByRole("button", { name }).className).toMatch(TARGET_44);
    render(<ReportButton remixId={REMIX} authorName="Priya" signedIn={false} own={false} returnTo="/remixes" />);
    expect(screen.getByRole("link", { name: /sign in to report/i }).className).toMatch(TARGET_44);
  });
});
