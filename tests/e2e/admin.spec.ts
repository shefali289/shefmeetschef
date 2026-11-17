import { expect, test } from "@playwright/test";

// These run against the build with no Supabase env (the default local preview).

test("/admin shows sign-in prompt when Supabase is not configured", async ({ page }) => {
  const res = await page.goto("/admin");
  expect(res?.status()).toBeLessThan(500);
  await expect(page.getByText(/sign in/i).first()).toBeVisible();
  await expect(page.getByText(/not set up yet/i).first()).toBeVisible();
  // no admin tools leak to anonymous visitors
  await expect(page.getByRole("button", { name: /import now/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /publish/i })).toHaveCount(0);
});

test("sign-in page explains sign-in is not set up yet without Supabase env", async ({ page }) => {
  const res = await page.goto("/sign-in");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  await expect(page.getByText(/sign-in is not set up yet/i)).toBeVisible();
  // no broken Google / magic-link controls without Supabase
  await expect(page.getByRole("button", { name: /google/i })).toHaveCount(0);
});
