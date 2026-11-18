import { afterEach, describe, expect, it, vi } from "vitest";
import { daysLeftText, defaultChallengeWeek, hasEnded, isOpen, nzToday } from "./dates";

/*
 * Contract (client-safe, no server imports):
 *   nzToday(now = new Date()) -> "YYYY-MM-DD" in Pacific/Auckland.
 *   defaultChallengeWeek(now = new Date()) -> { startsOn, endsOn }: the NZ Monday (today if it is
 *     Monday in NZ, else the next Monday) to the Sunday six days later.
 *   daysLeftText(today, endsOn): days after today until endsOn; "3 days left", "1 day left",
 *     "Last day today" (endsOn is today), "Ended" (endsOn is before today).
 *   isOpen({ startsOn, endsOn }, today = nzToday()) inclusive; hasEnded({ endsOn }, today) when
 *     today > endsOn.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("challenge dates", () => {
  it("nzToday uses Pacific/Auckland", () => {
    // NZ daylight time in November (UTC+13)
    expect(nzToday(new Date("2026-11-18T10:59:00Z"))).toBe("2026-11-18");
    expect(nzToday(new Date("2026-11-18T11:00:00Z"))).toBe("2026-11-19");
    // NZ standard time in July (UTC+12)
    expect(nzToday(new Date("2026-06-30T11:59:00Z"))).toBe("2026-06-30");
    expect(nzToday(new Date("2026-06-30T12:00:00Z"))).toBe("2026-07-01");
    // year boundary
    expect(nzToday(new Date("2026-12-31T11:30:00Z"))).toBe("2027-01-01");

    // the default is now
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T20:00:00Z"));
    expect(nzToday()).toBe("2026-11-19");
  });

  it("defaultChallengeWeek is Monday to Sunday NZ (today if Monday, else next Monday)", () => {
    // Wednesday 18 November NZ -> Monday 23 to Sunday 29
    expect(defaultChallengeWeek(new Date("2026-11-18T01:00:00Z"))).toEqual({ startsOn: "2026-11-23", endsOn: "2026-11-29" });
    // Monday 23 November 00:30 NZ (still Sunday in UTC) -> today
    expect(defaultChallengeWeek(new Date("2026-11-22T11:30:00Z"))).toEqual({ startsOn: "2026-11-23", endsOn: "2026-11-29" });
    // Sunday 22 November 23:00 NZ -> tomorrow
    expect(defaultChallengeWeek(new Date("2026-11-22T10:00:00Z"))).toEqual({ startsOn: "2026-11-23", endsOn: "2026-11-29" });
    // Tuesday 24 November 01:00 NZ (still Monday in UTC) -> next Monday, across a month end
    expect(defaultChallengeWeek(new Date("2026-11-23T12:00:00Z"))).toEqual({ startsOn: "2026-11-30", endsOn: "2026-12-06" });
    // across the daylight-saving change (NZ clocks go forward on Sunday 27 September 2026)
    expect(defaultChallengeWeek(new Date("2026-09-23T00:00:00Z"))).toEqual({ startsOn: "2026-09-28", endsOn: "2026-10-04" });
    expect(defaultChallengeWeek(new Date("2026-09-20T00:00:00Z"))).toEqual({ startsOn: "2026-09-21", endsOn: "2026-09-27" });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T01:00:00Z"));
    expect(defaultChallengeWeek()).toEqual({ startsOn: "2026-11-23", endsOn: "2026-11-29" });
  });

  it("daysLeftText gives 3 days left, 1 day left and Last day today", () => {
    expect(daysLeftText("2026-11-18", "2026-11-21")).toBe("3 days left");
    expect(daysLeftText("2026-11-20", "2026-11-21")).toBe("1 day left");
    expect(daysLeftText("2026-11-21", "2026-11-21")).toBe("Last day today");
    expect(daysLeftText("2026-11-23", "2026-11-29")).toBe("6 days left");
    // month end and the daylight-saving change are whole days
    expect(daysLeftText("2026-11-29", "2026-12-02")).toBe("3 days left");
    expect(daysLeftText("2026-09-26", "2026-09-29")).toBe("3 days left");
    expect(daysLeftText("2027-04-03", "2027-04-06")).toBe("3 days left");
    // after the end
    expect(daysLeftText("2026-11-22", "2026-11-21")).toBe("Ended");
  });

  it("isOpen and hasEnded use NZ dates", () => {
    const week = { startsOn: "2026-11-23", endsOn: "2026-11-29" };
    expect(isOpen(week, "2026-11-22")).toBe(false);
    expect(isOpen(week, "2026-11-23")).toBe(true);
    expect(isOpen(week, "2026-11-26")).toBe(true);
    expect(isOpen(week, "2026-11-29")).toBe(true);
    expect(isOpen(week, "2026-11-30")).toBe(false);
    expect(hasEnded(week, "2026-11-29")).toBe(false);
    expect(hasEnded(week, "2026-11-30")).toBe(true);
    expect(hasEnded(week, "2026-11-01")).toBe(false);

    // the default "today" is the NZ date, not the UTC one:
    // 2026-11-29T11:30Z is Monday 30 November 00:30 in NZ (still Sunday 29th in UTC)
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-29T11:30:00Z"));
    expect(isOpen(week)).toBe(false);
    expect(hasEnded(week)).toBe(true);
    // 2026-11-22T11:30Z is Monday 23 November 00:30 in NZ
    vi.setSystemTime(new Date("2026-11-22T11:30:00Z"));
    expect(isOpen(week)).toBe(true);
    expect(hasEnded(week)).toBe(false);
  });
});
