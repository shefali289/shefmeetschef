import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GeminiError } from "@/lib/import/gemini-parser";
import { postRemix, type DbError, type PostRemixDeps, type PostRemixInput, type RemixInsertRow, type RemixRecipe } from "./post-remix";
import type { ModerationVerdict, PhotoType, RemixStatus } from "./types";

/*
 * Task 3 slice D contract (extends postRemix in src/lib/remix/post-remix.ts):
 *   PostRemixDeps gains two optional deps:
 *     moderate?: ({ photo: { bytes, mimeType }, changes }) => Promise<ModerationVerdict>
 *       (moderateRemix with GEMINI_API_KEY; absent when Gemini is not set up)
 *     applyVerdict?: (remixId, verdict) => Promise<RemixStatus | null>
 *       (applyAiVerdict from the service path; null when the key is missing or the call failed)
 * - Only after a successful insert: moderate gets the bytes that were downloaded and sniffed, their
 *   real mime type, and the trimmed changes; then applyVerdict(id, verdict).
 * - The result follows the status the DATABASE returned, not the AI's word:
 *     "approved" -> { status: "approved", id, message: REMIX_LIVE_TEXT ("Your remix is live"...), remaining, limit }
 *     "hidden"   -> { status: "hidden", id, message (kind, includes the AI reason), reason, remaining, limit }
 *     "pending", null, a missing dep or any thrown error -> the usual pending result
 *       ("Thanks! Waiting for a quick check"). The AI's reason is never shown for review.
 * - A remix that was inserted is never removed here (its photo stays), whatever the verdict.
 */

const USER = "b0000000-0000-4000-8000-000000000002";
const PATH = `${USER}/0f8fad5b-d9cb-469f-a165-70867728950e.png`;
const RECIPE: RemixRecipe = { id: "11111111-1111-4111-8111-111111111111", slug: "masala-chai", title: "Masala Chai", source: "shef", status: "live" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

type ModerateInput = { photo: { bytes: Uint8Array; mimeType: PhotoType }; changes: string };

function deps(opts: {
  /** A verdict to return, or anything else (an Error, a DOMException) to reject with. */
  verdict?: ModerationVerdict | Error | DOMException;
  applied?: RemixStatus | null | Error;
  insertError?: DbError;
  withModerate?: boolean;
  withApply?: boolean;
} = {}) {
  const order: string[] = [];
  const moderate = vi.fn(async (_i: ModerateInput): Promise<ModerationVerdict> => {
    order.push("moderate");
    const v = opts.verdict ?? { verdict: "approve", reason: "A lovely cup of chai." };
    // DOMException is not always an Error subclass (jsdom), so reject on anything that is not a verdict.
    if (!(typeof v === "object" && v !== null && "verdict" in v && "reason" in v)) throw v;
    return v as ModerationVerdict;
  });
  const applyVerdict = vi.fn(async (_id: string, _v: ModerationVerdict): Promise<RemixStatus | null> => {
    order.push("applyVerdict");
    const a = opts.applied === undefined ? "approved" : opts.applied;
    if (a instanceof Error) throw a;
    return a;
  });
  const d = {
    findRecipe: vi.fn(async () => RECIPE),
    download: vi.fn(async () => {
      order.push("download");
      return PNG;
    }),
    removePhoto: vi.fn(async () => {
      order.push("removePhoto");
    }),
    insertRemix: vi.fn(async (_row: RemixInsertRow) => {
      order.push("insert");
      return opts.insertError ? { error: opts.insertError } : { id: "remix-1" };
    }),
    remaining: vi.fn(async () => {
      order.push("remaining");
      return 3;
    }),
    isBanned: vi.fn(async () => false),
    ...(opts.withModerate === false ? {} : { moderate }),
    ...(opts.withApply === false ? {} : { applyVerdict }),
  } satisfies PostRemixDeps;
  return { d: d as PostRemixDeps, moderate, applyVerdict, removePhoto: d.removePhoto, order };
}

const input = (over: Partial<PostRemixInput> = {}): PostRemixInput => ({
  userId: USER,
  slug: "masala-chai",
  photoPath: PATH,
  changes: "  Used oat milk and less sugar.  ",
  ...over,
});

const PENDING = /Thanks! Waiting for a quick check/;

describe("postRemix with moderation", () => {
  it("after the insert it checks the photo and text and applies the verdict through the service path", async () => {
    const { d, moderate, applyVerdict, order } = deps();
    await postRemix(input(), d);
    expect(moderate).toHaveBeenCalledTimes(1);
    const arg = moderate.mock.calls[0][0];
    expect(arg.photo.mimeType).toBe("image/png"); // the sniffed type, not the file name
    expect(Array.from(arg.photo.bytes)).toEqual(Array.from(PNG));
    expect(arg.changes).toBe("Used oat milk and less sugar.");
    expect(applyVerdict).toHaveBeenCalledWith("remix-1", { verdict: "approve", reason: "A lovely cup of chai." });
    expect(order.indexOf("insert")).toBeLessThan(order.indexOf("moderate"));
    expect(order.indexOf("moderate")).toBeLessThan(order.indexOf("applyVerdict"));
  });

  it("approve says Your remix is live", async () => {
    const { d, removePhoto } = deps();
    const res = await postRemix(input(), d);
    expect(res).toEqual({ status: "approved", id: "remix-1", message: expect.stringMatching(/your remix is live/i), remaining: 3, limit: 5 });
    expect(removePhoto).not.toHaveBeenCalled();
  });

  it("reject returns the kind reason with status hidden", async () => {
    const reason = "The photo doesn't seem to show food.";
    const { d, removePhoto } = deps({ verdict: { verdict: "reject", reason }, applied: "hidden" });
    const res = await postRemix(input(), d);
    expect(res).toMatchObject({ status: "hidden", id: "remix-1", reason, remaining: 3, limit: 5 });
    const message = (res as { message: string }).message;
    expect(message).toContain(reason);
    expect(message).toMatch(/sorry/i);
    expect(message).not.toMatch(/reject|violat|banned/i);
    // the remix row exists (hidden), so its photo is kept
    expect(removePhoto).not.toHaveBeenCalled();
  });

  it("NIT8: the hidden message adds a full stop when the reason has no ending punctuation", async () => {
    const bare = deps({ verdict: { verdict: "reject", reason: "The photo doesn't seem to show food" }, applied: "hidden" });
    const res = await postRemix(input(), bare.d);
    const message = (res as { message: string }).message;
    expect(message).toContain("The photo doesn't seem to show food.");
    expect(message).not.toMatch(/\.\./);
    // reason stays as the AI gave it
    expect((res as { reason: string }).reason).toBe("The photo doesn't seem to show food");

    for (const reason of ["Please show the dish!", "Is this food?", "Not food."]) {
      const c = deps({ verdict: { verdict: "reject", reason }, applied: "hidden" });
      const m = ((await postRemix(input(), c.d)) as { message: string }).message;
      expect(m).toContain(reason);
      expect(m).not.toContain(`${reason}.`);
    }
  });

  it("review stays pending and never shows the AI's reason", async () => {
    const { d } = deps({ verdict: { verdict: "review", reason: "Possibly raw chicken advice" }, applied: "pending" });
    const res = await postRemix(input(), d);
    expect(res).toEqual({ status: "pending", id: "remix-1", message: expect.stringMatching(PENDING), remaining: 3, limit: 5 });
    expect(JSON.stringify(res)).not.toContain("raw chicken");
  });

  it("the result follows the database, not the AI: an approve the database left pending is pending", async () => {
    const { d } = deps({ verdict: { verdict: "approve", reason: "ok" }, applied: "pending" });
    const res = await postRemix(input(), d);
    expect(res.status).toBe("pending");
  });

  it("a Gemini error, a missing key or a failed verdict call leaves it pending with Waiting for a quick check", async () => {
    const cases = [
      deps({ verdict: new GeminiError("Gemini request failed with status 503", 503) }),
      deps({ verdict: new DOMException("The operation was aborted due to timeout", "TimeoutError") }),
      deps({ withModerate: false }), // GEMINI_API_KEY not set
      deps({ applied: null }), // service key missing or rpc failed
      deps({ applied: new Error("fetch failed") }),
      deps({ withApply: false }),
    ];
    for (const [i, c] of cases.entries()) {
      const res = await postRemix(input(), c.d);
      expect({ i, res }).toEqual({
        i,
        res: { status: "pending", id: "remix-1", message: expect.stringMatching(PENDING), remaining: 3, limit: 5 },
      });
      expect(c.removePhoto).not.toHaveBeenCalled();
      expect(JSON.stringify(res)).not.toMatch(/Gemini|503|fetch failed/);
    }
    // the timeout case really rejected with a DOMException TimeoutError
    expect(cases[1].moderate).toHaveBeenCalledTimes(1);
    await expect(cases[1].moderate.mock.results[0].value).rejects.toSatisfy(
      (e: unknown) => e instanceof DOMException && e.name === "TimeoutError",
    );
    expect(cases[1].applyVerdict).not.toHaveBeenCalled();
    // a Gemini failure never reaches the verdict call
    expect(cases[0].applyVerdict).not.toHaveBeenCalled();
    expect(cases[2].applyVerdict).not.toHaveBeenCalled();
  });

  it("moderation never runs when the insert failed", async () => {
    for (const insertError of [
      { code: "SMU01", message: "usage_limit_reached" },
      { code: "42501", message: "new row violates row-level security policy" },
      { code: "XX000", message: "boom" },
    ]) {
      const { d, moderate, applyVerdict } = deps({ insertError });
      const res = await postRemix(input(), d);
      expect(res.status).not.toMatch(/approved|hidden|pending/);
      expect(moderate).not.toHaveBeenCalled();
      expect(applyVerdict).not.toHaveBeenCalled();
    }
    // nor when the photo or text was invalid
    const { d, moderate } = deps();
    await postRemix(input({ changes: "" }), d);
    await postRemix(input({ photoPath: "someone-else/x.jpg" }), d);
    expect(moderate).not.toHaveBeenCalled();
  });
});
