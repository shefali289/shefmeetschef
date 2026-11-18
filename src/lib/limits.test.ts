import { describe, expect, it } from "vitest";
import { FREE_LIMITS, questionsLeftText, reelsLeftText, savesUsedText } from "./limits";

describe("free limits", () => {
  it("free limits are 10 ask a day, 5 reels a month, 30 saves", () => {
    expect(FREE_LIMITS).toEqual({ ask: 10, outside_reel: 5, saves: 30 });
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
});
