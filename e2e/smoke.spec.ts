import { expect, test } from "@playwright/test";

test("login page is usable without an authenticated session", async ({ page }) => {
  await page.goto("/login");
  // A local demo server redirects straight into the app; a configured server
  // must render the real login form.
  if (page.url().endsWith("/dashboard")) {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Přehled pohledávek");
    return;
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Přihlášení");
  await expect(page.getByLabel("Firemní e-mail")).toBeVisible();
  await expect(page.getByLabel("Heslo")).toBeVisible();
});

test("dashboard loads without browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/dashboard");
  test.skip(page.url().includes("/login"), "Configured local server requires a real test session");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Přehled pohledávek");
  expect(errors).toEqual([]);
});

test("mobile layout does not overflow horizontally", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only viewport assertion");
  await page.goto("/dashboard");
  const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1);
});
