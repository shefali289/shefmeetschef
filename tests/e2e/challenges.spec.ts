import { expect, test } from "@playwright/test";

// Runs with no Supabase env vars: the site serves sample recipes and challenges are not set up.

test("/challenges shows not set up yet without Supabase", async ({ page }) => {
  const res = await page.goto("/challenges");
  expect(res?.status()).toBe(200);
  await expect(page.getByText(/challenges are not set up yet/i).first()).toBeVisible();
  // not configured is not signed out: no bounce to sign-in
  await expect(page).toHaveURL(/\/challenges$/);

  const one = await page.goto("/challenges/c2c2c2c2-0000-4000-8000-000000000002");
  expect(one?.status()).toBe(200);
  await expect(page.getByText(/challenges are not set up yet/i).first()).toBeVisible();
});

test("home has no challenge banner without Supabase", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /latest recipes/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /remix challenge/i })).toHaveCount(0);
  await expect(page.getByText(/#ShefMeetsChefRemix/)).toHaveCount(0);

  // nor on a sample recipe page
  await page.goto("/recipes/masala-chai");
  await expect(page.getByText(/#ShefMeetsChefRemix/)).toHaveCount(0);
});
