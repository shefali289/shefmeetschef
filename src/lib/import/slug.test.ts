import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "./slug";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("slugify", () => {
  it("slugifies titles with accents and symbols", () => {
    expect(slugify("Masala Chai")).toBe("masala-chai");
    expect(slugify("Crème Brûlée & Chai!")).toBe("creme-brulee-chai");
    expect(slugify("  Paneer Tikka (Air-Fryer) 🔥 ")).toBe("paneer-tikka-air-fryer");
    expect(slugify("Mum's 5-minute   Poha")).toBe("mums-5-minute-poha");
    expect(slugify("Jalebi -- crispy__sweet")).toBe("jalebi-crispy-sweet");
    // nothing usable left: still a valid slug
    expect(slugify("🔥🔥🔥")).toBe("recipe");
    expect(slugify("")).toBe("recipe");
    for (const t of ["Crème Brûlée & Chai!", "🔥", "a/b\\c?d#e", "<script>alert(1)</script>"]) {
      expect(slugify(t)).toMatch(SLUG_RE);
    }
  });

  it("caps very long titles", () => {
    const s = slugify("Chai ".repeat(100));
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s).toMatch(SLUG_RE);
  });
});

describe("uniqueSlug", () => {
  it("appends -2, -3 for duplicates", () => {
    expect(uniqueSlug("Masala Chai", new Set())).toBe("masala-chai");
    expect(uniqueSlug("Masala Chai", new Set(["masala-chai"]))).toBe("masala-chai-2");
    expect(uniqueSlug("Masala Chai", new Set(["masala-chai", "masala-chai-2"]))).toBe(
      "masala-chai-3",
    );
    expect(uniqueSlug("Masala Chai", new Set(["masala-chai-2"]))).toBe("masala-chai");
  });
});
