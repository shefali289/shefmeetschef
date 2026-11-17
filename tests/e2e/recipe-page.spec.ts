import { expect, test } from "@playwright/test";

// The implementer must ship a live sample recipe with this slug in src/lib/sample-recipes.ts.
const SAMPLE_SLUG = "masala-chai";

test("sample recipe page renders title, ingredients, steps and JSON-LD server-side", async ({
  page,
  request,
}) => {
  // Raw server HTML, no JavaScript: proves server rendering for SEO.
  const res = await request.get(`/recipes/${SAMPLE_SLUG}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toMatch(/<h1[^>]*>[^<]*Masala Chai/i);
  expect(html).toContain('type="application/ld+json"');
  const ldMatch = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  expect(ldMatch).not.toBeNull();
  const ld = JSON.parse(ldMatch![1]);
  expect(ld["@type"]).toBe("Recipe");
  expect(ld.recipeIngredient.length).toBeGreaterThan(0);
  expect(html).toMatch(/<meta property="og:title"[^>]*Masala Chai/i);

  await page.goto(`/recipes/${SAMPLE_SLUG}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/masala chai/i);
  await expect(page.getByRole("heading", { name: /ingredients/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /steps|method/i })).toBeVisible();
  await expect(page.getByText("Always check labels if you have an allergy.")).toBeVisible();
});

test("unknown slug returns 404", async ({ page }) => {
  const res = await page.goto("/recipes/this-recipe-does-not-exist");
  expect(res?.status()).toBe(404);
});

test("slider updates quantities on mobile", async ({ page }) => {
  await page.goto(`/recipes/${SAMPLE_SLUG}`);
  const slider = page.getByRole("slider", { name: /servings/i });
  await expect(slider).toBeVisible();
  const box = await slider.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(24);

  const list = page.locator("ul", { has: page.getByRole("listitem") }).filter({
    has: page.getByText(/milk/i),
  }).first();
  const before = await list.innerText();

  await slider.fill("8");
  await expect(slider).toHaveAttribute("aria-valuetext", "8 servings");
  await expect.poll(() => list.innerText()).not.toBe(before);

  // keyboard works in a real browser
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuetext", "7 servings");
});
