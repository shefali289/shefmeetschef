import { describe, expect, it } from "vitest";
import { FREE_LIMITS, limitReachedText, questionsLeftText, reelsLeftText, remixesLeftText, savesUsedText } from "./limits";

describe("free limits", () => {
  it("free limits are 10 ask a day, 5 reels a month, 30 saves", () => {
    // CHANGED IN TASK 3 (slice B, on purpose): remix joins the free limits (5 a NZ day).
    expect(FREE_LIMITS).toEqual({ ask: 10, outside_reel: 5, saves: 30, remix: 5 });
  });

  it("formats 7 of 10 questions left today", () => {
    expect(questionsLeftText(7)).toBe("7 of 10 questions left today");
    expect(questionsLeftText(0)).toBe("0 of 10 questions left today");
    expect(questionsLeftText(7, 20)).toBe("7 of 20 questions left today");
    // never shows a negative or over-limit count
    expect(questionsLeftText(-2)).toBe("0 of 10 questions left today");
    expect(questionsLeftText(99)).toBe("10 of 10 questions left today");
  });

  it("formats 3 of 5 left this month", () => {
    expect(reelsLeftText(3)).toBe("3 of 5 left this month");
    expect(reelsLeftText(0)).toBe("0 of 5 left this month");
    expect(reelsLeftText(-1)).toBe("0 of 5 left this month");
  });

  it("formats 12 of 30 saves used", () => {
    expect(savesUsedText(12)).toBe("12 of 30 saves used");
    expect(savesUsedText(30)).toBe("30 of 30 saves used");
    expect(savesUsedText(0)).toBe("0 of 30 saves used");
  });

  /* ---------- task 3 slice B: remixes ---------- */
  it("free limit is 5 remixes a day", () => {
    expect(FREE_LIMITS).toMatchObject({ remix: 5 });
  });

  it("formats 3 of 5 remixes left today", () => {
    expect(remixesLeftText(3)).toBe("3 of 5 remixes left today");
    expect(remixesLeftText(0)).toBe("0 of 5 remixes left today");
    expect(remixesLeftText(3, 8)).toBe("3 of 8 remixes left today");
    // never negative or over the limit
    expect(remixesLeftText(-1)).toBe("0 of 5 remixes left today");
    expect(remixesLeftText(42)).toBe("5 of 5 remixes left today");
  });

  it("limitReachedText for remix says come back tomorrow", () => {
    const text = limitReachedText("remix");
    expect(text).toMatch(/come back tomorrow/i);
    expect(text).toContain("0 of 5 remixes left today");
    expect(limitReachedText("remix", 8)).toContain("0 of 8 remixes left today");
    // the other kinds are unchanged
    expect(limitReachedText("ask")).toContain("0 of 10 questions left today");
    expect(limitReachedText("outside_reel")).toContain("0 of 5 left this month");
  });
});
