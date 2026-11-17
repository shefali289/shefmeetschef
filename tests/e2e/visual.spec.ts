import { expect, test } from "@playwright/test";

// UI polish (task-1 addendum). Visual styling itself is checked by screenshots and review;
// these checks cover behaviour: photos load, footer exists, no errors, reduced motion shows all.

test("home loads the hero photo, footer and has no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");

  const hero = page.locator("main img[alt*='Shef']").first();
  await expect(hero).toBeVisible();
  await expect
    .poll(() => hero.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);

  const footer = page.getByRole("contentinfo");
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeVisible();
  await expect(footer.getByText(/good food, good mood/i)).toBeVisible();

  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("every [data-reveal] element is shown without scrolling", async ({ page }) => {
    await page.goto("/");
    const reveals = page.locator("[data-reveal]");
    await expect(reveals.first()).toBeAttached();
    const count = await reveals.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const el = reveals.nth(i);
      await expect(el).toHaveAttribute("data-revealed", "true");
      await expect(el).toHaveCSS("opacity", "1");
      await expect(el).toHaveCSS("transform", "none");
    }
    // Never scrolled: still at the top of the page.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});
