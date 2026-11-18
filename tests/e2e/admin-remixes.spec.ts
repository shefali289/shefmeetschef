import { expect, test } from "@playwright/test";

// Task 3 slice D. These run against the build with no Supabase env (the default local preview).

test("/admin/remixes and /admin/challenges show the not set up notice without Supabase", async ({ page }) => {
  for (const path of ["/admin/remixes", "/admin/challenges"]) {
    const res = await page.goto(path);
    expect({ path, status: res?.status() }).toEqual({ path, status: 200 });
    await expect(page.getByText(/not set up yet/i).first()).toBeVisible();
    // no moderation tools leak to anonymous visitors
    for (const name of [/approve/i, /hide/i, /^ban/i, /unban/i, /create challenge/i]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
    await expect(page.getByText(/nothing to check/i)).toHaveCount(0);
  }
});

test("remix cards offer no Report button without Supabase", async ({ page }) => {
  const res = await page.goto("/remixes");
  expect(res?.status()).toBeLessThan(500);
  await expect(page.getByText(/not set up yet/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /report/i })).toHaveCount(0);
});
