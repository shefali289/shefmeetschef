import { expect, test } from "@playwright/test";

// These run against the build with no Supabase or Gemini env (the default local preview).

test("anonymous visitor sees Sign in to ask Shef", async ({ page }) => {
  const res = await page.goto("/recipes/masala-chai");
  expect(res?.status()).toBe(200);
  await expect(page.getByText(/sign in to ask shef/i).first()).toBeVisible();
  await expect(page.getByText(/not set up yet/i).first()).toBeVisible();
  // no question box or ask button for anonymous visitors
  await expect(page.getByRole("textbox", { name: /question|ask shef/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^ask shef$/i })).toHaveCount(0);
});

test("/add-reel shows not set up yet without Supabase", async ({ page }) => {
  const res = await page.goto("/add-reel");
  expect(res?.status()).toBeLessThan(500);
  expect(res?.status()).not.toBe(404);
  await expect(page.getByText(/not set up yet/i).first()).toBeVisible();
  await expect(page.getByLabel(/caption/i)).toHaveCount(0);
  await expect(page.getByLabel(/reel link|instagram link/i)).toHaveCount(0);
});
