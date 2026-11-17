import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-redirect";

describe("safeNext", () => {
  it("allows relative paths", () => {
    expect(safeNext("/admin")).toBe("/admin");
    expect(safeNext("/recipes/masala-chai")).toBe("/recipes/masala-chai");
    expect(safeNext("/recipes?q=chai&diet=vegan#top")).toBe("/recipes?q=chai&diet=vegan#top");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    for (const bad of [
      "https://evil.example/",
      "http://evil.example",
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "javascript:alert(1)",
      "data:text/html,hi",
      "admin",
      " /admin",
    ]) {
      expect(safeNext(bad), bad).toBe("/");
    }
  });

  it("falls back to / for empty or missing values", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
  });
});
