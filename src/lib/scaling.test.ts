import { describe, expect, it } from "vitest";
import {
  clampServings,
  formatQuantity,
  ingredientText,
  scaleIngredients,
  scaleQuantity,
} from "./scaling";
import type { Ingredient } from "./types";

describe("formatQuantity", () => {
  it("formats 1.5 as 1 1/2", () => {
    expect(formatQuantity(1.5)).toBe("1 1/2");
    expect(formatQuantity(2.75)).toBe("2 3/4");
  });

  it("formats 0.333 as 1/3 and 0.25 as 1/4", () => {
    expect(formatQuantity(0.333)).toBe("1/3");
    expect(formatQuantity(1 / 3)).toBe("1/3");
    expect(formatQuantity(2 / 3)).toBe("2/3");
    expect(formatQuantity(0.25)).toBe("1/4");
    expect(formatQuantity(0.5)).toBe("1/2");
    expect(formatQuantity(0.125)).toBe("1/8");
  });

  it("formats whole numbers without fraction", () => {
    expect(formatQuantity(1)).toBe("1");
    expect(formatQuantity(4)).toBe("4");
    expect(formatQuantity(250)).toBe("250");
  });

  it("rounds to nearest eighth/third", () => {
    expect(formatQuantity(0.3)).toBe("1/3"); // 1/3 is closer than 1/4 or 3/8
    expect(formatQuantity(0.13)).toBe("1/8");
    expect(formatQuantity(0.6)).toBe("5/8"); // 0.625 closer than 0.667
    expect(formatQuantity(2.66)).toBe("2 2/3");
    expect(formatQuantity(0.74)).toBe("3/4");
    expect(formatQuantity(1.99)).toBe("2"); // rounds up to a whole number
    expect(formatQuantity(3.01)).toBe("3");
    // eighths are reduced: 2/8 -> 1/4, 4/8 -> 1/2, 6/8 -> 3/4
    expect(formatQuantity(1.25)).toBe("1 1/4");
  });
});

describe("scaleQuantity / scaleIngredients", () => {
  const list: Ingredient[] = [
    { qty: 2, unit: "cup", item: "milk", note: "full cream" },
    { qty: 1, unit: "tsp", item: "cardamom" },
    { qty: null, unit: null, item: "salt", note: "to taste" },
  ];

  it("scales 2 cups at 4 servings to 1 cup at 2", () => {
    expect(scaleQuantity(2, 4, 2)).toBe(1);
    expect(scaleQuantity(1, 2, 3)).toBe(1.5);
    expect(scaleQuantity(3, 4, 4)).toBe(3);
    const scaled = scaleIngredients(list, 4, 2);
    expect(scaled[0].qty).toBe(1);
    expect(scaled[1].qty).toBe(0.5);
  });

  it("keeps unit and note unchanged", () => {
    const scaled = scaleIngredients(list, 4, 8);
    expect(scaled[0]).toEqual({ qty: 4, unit: "cup", item: "milk", note: "full cream" });
    expect(scaled[1].unit).toBe("tsp");
    expect(scaled[1].item).toBe("cardamom");
    // does not mutate the input list
    expect(list[0].qty).toBe(2);
  });

  it("leaves null qty (to taste) untouched", () => {
    expect(scaleQuantity(null, 4, 8)).toBeNull();
    const scaled = scaleIngredients(list, 4, 8);
    expect(scaled[2]).toEqual({ qty: null, unit: null, item: "salt", note: "to taste" });
  });

  it("clamps servings to 1..12", () => {
    expect(clampServings(0)).toBe(1);
    expect(clampServings(-3)).toBe(1);
    expect(clampServings(13)).toBe(12);
    expect(clampServings(100)).toBe(12);
    expect(clampServings(6)).toBe(6);
    expect(clampServings(4.6)).toBe(5); // rounds to a whole serving
    expect(clampServings(Number.NaN)).toBe(1);
  });
});

describe("metric units", () => {
  it("rounds g and ml to whole numbers", () => {
    expect(formatQuantity(400 / 3, "g")).toBe("133");
    expect(formatQuantity(62.5, "ml")).toBe("63");
    expect(formatQuantity(250, "g")).toBe("250");
    expect(formatQuantity(0.4, "g")).not.toBe("0"); // never shows a positive amount as 0
    expect(ingredientText({ qty: 400 / 3, unit: "g", item: "paneer" })).toBe("133 g paneer");
    expect(ingredientText({ qty: 187.5, unit: "ml", item: "milk" })).toBe("188 ml milk");
  });

  it("rounds kg and l to one decimal", () => {
    expect(formatQuantity(4 / 3, "kg")).toBe("1.3");
    expect(formatQuantity(0.76, "l")).toBe("0.8");
    expect(formatQuantity(2, "kg")).toBe("2"); // no trailing .0
    expect(ingredientText({ qty: 4 / 3, unit: "kg", item: "chicken" })).toBe("1.3 kg chicken");
  });

  it("keeps fractions for kitchen units and no unit", () => {
    expect(formatQuantity(1.5, "tsp")).toBe("1 1/2");
    expect(formatQuantity(1.5, null)).toBe("1 1/2");
    expect(formatQuantity(1.5)).toBe("1 1/2");
    expect(ingredientText({ qty: 1.5, unit: "cup", item: "rice" })).toBe("1 1/2 cup rice");
  });
});
