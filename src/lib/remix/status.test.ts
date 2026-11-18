import { describe, expect, it } from "vitest";
import { statusLabel } from "./status";

/*
 * Task 3 slice D contract (src/lib/remix/status.ts, client-safe; feed.ts re-exports it):
 *   statusLabel(status, moderation?: { hiddenBy?: HiddenBy | null; aiReason?: string | null })
 *   - approved "Live"; pending "Waiting for a quick check" (the AI reason is never shown for review).
 *   - hidden by the AI with a reason: "Hidden: <reason>"; hidden by reports:
 *     "Hidden while Shef takes a look"; hidden by the admin, a ban or with no detail: "Hidden".
 *   - With no second argument it behaves as in slice B.
 */

describe("statusLabel with moderation", () => {
  it("statusLabel gives Hidden with the AI reason, or Hidden while Shef takes a look for reports", () => {
    expect(statusLabel("hidden", { hiddenBy: "ai", aiReason: "The photo doesn't seem to show food." })).toBe(
      "Hidden: The photo doesn't seem to show food.",
    );
    expect(statusLabel("hidden", { hiddenBy: "reports", aiReason: null })).toBe("Hidden while Shef takes a look");
    // the AI reason of an earlier check is not shown when the remix was hidden for another reason
    expect(statusLabel("hidden", { hiddenBy: "reports", aiReason: "fine" })).toBe("Hidden while Shef takes a look");
    expect(statusLabel("hidden", { hiddenBy: "admin", aiReason: "fine" })).toBe("Hidden");
    expect(statusLabel("hidden", { hiddenBy: "ban", aiReason: null })).toBe("Hidden");
    expect(statusLabel("hidden", { hiddenBy: "ai", aiReason: "  " })).toBe("Hidden");
    expect(statusLabel("hidden", { hiddenBy: null })).toBe("Hidden");
  });

  it("pending never shows the AI reason and approved stays Live", () => {
    expect(statusLabel("pending", { hiddenBy: null, aiReason: "Possibly unsafe advice" })).toBe("Waiting for a quick check");
    expect(statusLabel("approved", { hiddenBy: null, aiReason: "Food" })).toBe("Live");
    // slice B behaviour without moderation details
    expect(statusLabel("hidden")).toBe("Hidden");
  });
});
