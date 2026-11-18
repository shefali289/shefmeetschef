import { expect, test } from "@playwright/test";

// Runs with no Supabase env vars: the site serves sample recipes and sign-in is not set up.
const SAMPLE_SLUG = "masala-chai";

test("/cookbook shows not set up yet without Supabase", async ({ page }) => {
  const res = await page.goto("/cookbook");
  expect(res?.status()).toBe(200);
  await expect(page.getByText(/not set up yet/i)).toBeVisible();
  // Not configured is not the same as signed out: no bounce to sign-in.
  await expect(page).toHaveURL(/\/cookbook$/);
  // No Cookbook link in the header when sign-in is not set up.
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /cookbook/i })).toHaveCount(0);
});

test("recipe page heart is reachable by keyboard", async ({ page }) => {
  await page.goto(`/recipes/${SAMPLE_SLUG}`);
  const heart = page.getByRole("link", { name: /save to my cookbook|sign in to save/i });
  await expect(heart).toHaveCount(1);
  await expect(heart).toHaveAttribute("href", `/sign-in?next=${encodeURIComponent(`/recipes/${SAMPLE_SLUG}`)}`);

  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await heart.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  await expect(heart).toBeFocused();

  const box = await heart.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
});
