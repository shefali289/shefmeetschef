import { expect, test } from "@playwright/test";

// Runs with no Supabase env vars: the site serves sample recipes and remixes are not set up.
const SAMPLE_SLUG = "masala-chai";

test("Remix this is reachable by keyboard and says not set up yet without Supabase", async ({ page }) => {
  const res = await page.goto(`/recipes/${SAMPLE_SLUG}`);
  expect(res?.status()).toBe(200);
  const remix = page.getByRole("link", { name: /remix this/i });
  await expect(remix).toHaveCount(1);
  await expect(page.getByText(/Remixes are not set up yet/i).first()).toBeVisible();

  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await remix.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  await expect(remix).toBeFocused();

  const box = await remix.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);

  // Enter follows it to the remix page, which explains instead of bouncing to sign-in
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/recipes/${SAMPLE_SLUG}/remix$`));
  await expect(page.getByText(/not set up yet/i).first()).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test("/remixes shows not set up yet without Supabase", async ({ page }) => {
  const res = await page.goto("/remixes");
  expect(res?.status()).toBe(200);
  await expect(page.getByText(/Remixes are not set up yet/i).first()).toBeVisible();
  // Not configured is not the same as signed out: no bounce to sign-in.
  await expect(page).toHaveURL(/\/remixes$/);
});
