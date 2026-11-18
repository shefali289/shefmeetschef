import { afterEach, describe, expect, it } from "vitest";
import type { ShefVersion } from "@/lib/ask-shef/types";
import { saveRemixPrefill, shefVersionToChanges, takeRemixPrefill, validateChanges } from "./changes";

/*
 * Contract (src/lib/remix/changes.ts, client-safe):
 *   validateChanges(text: unknown) -> { ok: true, value: trimmed } | { ok: false, error: friendly }
 *     accepting 1 to 2000 characters after trimming (the database check is the same).
 *   shefVersionToChanges(original, version) -> plain text listing the ingredients and steps Shef's
 *     version changed (unchanged ones left out), at most 2000 characters, always postable.
 *   saveRemixPrefill(slug, text) / takeRemixPrefill(slug): sessionStorage (never localStorage),
 *     for one recipe, read once (taking it clears it).
 */

const ORIGINAL: ShefVersion = {
  ingredients: [
    { qty: 200, unit: "g", item: "paneer" },
    { qty: 1, unit: "tsp", item: "salt" },
  ],
  steps: [{ text: "Marinate the paneer." }, { text: "Grill for 10 minutes." }],
  diet_tags: ["vegetarian"],
};
const VEGAN: ShefVersion = {
  ingredients: [
    { qty: 200, unit: "g", item: "firm tofu" },
    { qty: 1, unit: "tsp", item: "salt" },
  ],
  steps: [{ text: "Press and marinate the tofu." }, { text: "Grill for 10 minutes." }],
  diet_tags: ["vegan"],
};

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("what I changed", () => {
  it("trims and accepts 1 to 2000 characters", () => {
    expect(validateChanges("  less salt, more ginger \n")).toEqual({ ok: true, value: "less salt, more ginger" });
    expect(validateChanges("x")).toEqual({ ok: true, value: "x" });
    expect(validateChanges("x".repeat(2000))).toEqual({ ok: true, value: "x".repeat(2000) });
    // the limit applies after trimming
    expect(validateChanges(`  ${"x".repeat(2000)}  `)).toEqual({ ok: true, value: "x".repeat(2000) });

    for (const bad of ["", "   ", "\n\t ", "x".repeat(2001), null, undefined, 42, ["less salt"]]) {
      const res = validateChanges(bad);
      expect({ bad, ok: res.ok }).toEqual({ bad, ok: false });
      if (!res.ok) expect(res.error).toEqual(expect.any(String));
    }
    const tooLong = validateChanges("x".repeat(2001));
    expect(!tooLong.ok && tooLong.error).toMatch(/2000/);
  });

  it("shefVersionToChanges lists the changed ingredients and steps and caps at 2000 characters", () => {
    const text = shefVersionToChanges(ORIGINAL, VEGAN);
    expect(text).toContain("firm tofu");
    expect(text).toContain("Press and marinate the tofu.");
    // unchanged lines are left out
    expect(text).not.toMatch(/salt/i);
    expect(text).not.toMatch(/Grill/);
    expect(validateChanges(text).ok).toBe(true);

    // a huge version is cut to fit, and is still postable
    const huge: ShefVersion = {
      ingredients: Array.from({ length: 200 }, (_, i) => ({ qty: i + 1, unit: "g", item: `spice number ${i} ${"z".repeat(40)}` })),
      steps: Array.from({ length: 100 }, (_, i) => ({ text: `Step ${i}: ${"stir gently ".repeat(10)}` })),
      diet_tags: ["vegan"],
    };
    const cut = shefVersionToChanges(ORIGINAL, huge);
    expect(cut.length).toBeGreaterThan(0);
    expect(cut.length).toBeLessThanOrEqual(2000);
    expect(validateChanges(cut).ok).toBe(true);
    // plain text: no markup is added
    expect(cut).not.toMatch(/<[a-z]/i);
  });

  it("remix prefill is kept in sessionStorage for one recipe and read once", () => {
    saveRemixPrefill("masala-chai", "Swapped milk for oat milk");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(1);
    // another recipe never picks it up
    expect(takeRemixPrefill("dal-makhani")).toBeNull();
    expect(takeRemixPrefill("masala-chai")).toBe("Swapped milk for oat milk");
    expect(takeRemixPrefill("masala-chai")).toBeNull();
    expect(sessionStorage.length).toBe(0);
    // nothing stored: null, never throws
    expect(takeRemixPrefill("masala-chai")).toBeNull();
  });
});
