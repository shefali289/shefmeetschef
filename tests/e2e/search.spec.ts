import { expect, test, type Page } from "@playwright/test";

// Relies on sample recipes (no Supabase keys): "masala-chai" (Indian, vegetarian, drinks, contains
// milk, so NOT vegan) and at least one live sample that is both Indian and vegan.

const cardLinks = (page: Page) => page.locator('main a[href^="/recipes/"]');

/** One-shot read of the card slugs currently in the grid. Wrap in expect.poll to retry. */
async function cardSlugs(page: Page): Promise<string[]> {
  const hrefs = await cardLinks(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute("href") ?? ""),
  );
  return [...new Set(hrefs.map((h) => h.replace("/recipes/", "")))];
}

const slugsOf = (page: Page) => () => cardSlugs(page);

test("home page shows hero and recipe grid", async ({ page }) => {
  await page.goto("/");

  // Layout-level skip link to #main, first in tab order.
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toHaveAttribute("href", "#main");
  await expect(page.locator("#main")).toHaveCount(1);

  await expect(page.getByRole("link", { name: /shefmeetschef/i }).first()).toHaveAttribute(
    "href",
    "/",
  );
  await expect(page.getByRole("heading", { name: /Hi, I['’]m Shef/ })).toBeVisible();
  await expect(page.getByText("Raw plates, honest bites & foodie experiments")).toBeVisible();
  await expect(page.getByText(/Very raw, unfiltered homemade food, no fancy plating/)).toBeVisible();
  await expect(cardLinks(page).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /masala chai/i })).toBeVisible();
});

test("typing a query filters the grid", async ({ page }) => {
  await page.goto("/recipes");

  // Heading order: h1 Recipes, then an (sr-only) h2 Results before the grid's h3 card titles.
  await expect(page.getByRole("heading", { level: 1, name: "Recipes" })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "Results" })).toHaveCount(1);

  await expect.poll(async () => (await cardSlugs(page)).length).toBeGreaterThan(1);
  const before = await cardSlugs(page);

  const search = page.getByRole("searchbox", { name: "Search recipes" });
  await search.fill("chai");
  await search.press("Enter");
  await expect(page).toHaveURL(/[?&]q=chai(&|$)/);

  await expect(page.getByRole("heading", { name: /masala chai/i })).toBeVisible();
  await expect.poll(slugsOf(page)).toContain("masala-chai");
  await expect.poll(async () => (await cardSlugs(page)).length).toBeLessThan(before.length);

  await search.fill("zzzz-nothing-matches");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=zzzz-nothing-matches/);
  await expect(cardLinks(page)).toHaveCount(0);
  await expect(page.getByText("No recipes match those filters yet.")).toBeVisible();
});

test("selecting vegan + Indian updates URL and results", async ({ page }) => {
  await page.goto("/recipes");
  const vegan = page.getByRole("group", { name: "Diet" }).getByRole("button", { name: /^vegan$/i });
  const indian = page
    .getByRole("group", { name: "Cuisine" })
    .getByRole("button", { name: /^indian$/i });

  // Tap target at least 44px tall on mobile.
  const box = await vegan.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await vegan.click();
  await expect(page).toHaveURL(/[?&]diet=vegan(&|$)/);
  await expect(vegan).toHaveAttribute("aria-pressed", "true");

  await indian.click();
  await expect(page).toHaveURL(/[?&]cuisine=indian(&|$)/);
  await expect(page).toHaveURL(/[?&]diet=vegan(&|$)/);
  await expect(indian).toHaveAttribute("aria-pressed", "true");

  // Masala chai has milk: not vegan, must be gone; something Indian + vegan remains.
  await expect.poll(slugsOf(page)).not.toContain("masala-chai");
  await expect.poll(async () => (await cardSlugs(page)).length).toBeGreaterThan(0);

  // Untoggle vegan: chai comes back.
  await vegan.click();
  await expect(page).not.toHaveURL(/diet=/);
  await expect(vegan).toHaveAttribute("aria-pressed", "false");
  await expect.poll(slugsOf(page)).toContain("masala-chai");
});

test("opening a shared filter URL restores the filters", async ({ page }) => {
  await page.goto("/recipes?q=chai&cuisine=indian&category=drinks&diet=vegetarian");
  await expect(page.getByRole("searchbox", { name: "Search recipes" })).toHaveValue("chai");
  await expect(
    page.getByRole("group", { name: "Cuisine" }).getByRole("button", { name: /^indian$/i }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("group", { name: "Category" }).getByRole("button", { name: /^drinks$/i }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("group", { name: "Diet" }).getByRole("button", { name: /^vegetarian$/i }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("group", { name: "Diet" }).getByRole("button", { name: /^vegan$/i }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(cardLinks(page)).toHaveCount(1);
  await expect.poll(slugsOf(page)).toEqual(["masala-chai"]);

  // Unknown values in a shared link are ignored, not an error.
  const res = await page.goto("/recipes?cuisine=klingon&diet=<script>");
  expect(res?.status()).toBe(200);
  await expect.poll(async () => (await cardSlugs(page)).length).toBeGreaterThan(1);
});
