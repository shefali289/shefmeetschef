// Client-safe NZ date helpers for challenges. Dates are YYYY-MM-DD calendar days in NZ.

const NZ_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Pacific/Auckland",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DAY_MS = 86_400_000;

/** Whole calendar days from a to b (both YYYY-MM-DD), so daylight saving never matters. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** YYYY-MM-DD shifted by n calendar days. */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Today's date in Pacific/Auckland as YYYY-MM-DD. */
export function nzToday(now: Date = new Date()): string {
  const parts = Object.fromEntries(NZ_DATE.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Monday to Sunday NZ: this Monday if today (NZ) is a Monday, else next Monday. */
export function defaultChallengeWeek(now: Date = new Date()): { startsOn: string; endsOn: string } {
  const today = nzToday(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sunday .. 6 Saturday
  const startsOn = addDays(today, (8 - weekday) % 7);
  return { startsOn, endsOn: addDays(startsOn, 6) };
}

/** "3 days left", "1 day left", "Last day today" (ends today), or "Ended". Dates are YYYY-MM-DD. */
export function daysLeftText(today: string, endsOn: string): string {
  const left = daysBetween(today, endsOn);
  if (left < 0) return "Ended";
  if (left === 0) return "Last day today";
  return left === 1 ? "1 day left" : `${left} days left`;
}

/** starts_on <= today <= ends_on (NZ dates, inclusive). */
export function isOpen(c: { startsOn: string; endsOn: string }, today: string = nzToday()): boolean {
  return c.startsOn <= today && today <= c.endsOn;
}

/** today > ends_on (NZ dates). */
export function hasEnded(c: { endsOn: string }, today: string = nzToday()): boolean {
  return today > c.endsOn;
}

/** "16 Nov to 22 Nov 2026" for a challenge's dates. */
export function formatChallengeDates(startsOn: string, endsOn: string): string {
  const fmt = (d: string, year: boolean) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-NZ", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      ...(year ? { year: "numeric" } : {}),
    });
  return `${fmt(startsOn, startsOn.slice(0, 4) !== endsOn.slice(0, 4))} to ${fmt(endsOn, true)}`;
}
