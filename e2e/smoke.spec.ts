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

test("sidebar stays mounted while navigating between workspace pages", async ({ page }) => {
  await page.goto("/dashboard");
  test.skip(page.url().includes("/login"), "Requires a demo or authenticated session");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar.locator('a[href="/invoices"]')).toBeVisible();
  await sidebar.evaluate(element => {
    element.setAttribute("data-persistence-check", "original");
  });
  for (const path of ["/invoices", "/reports", "/dashboard"]) {
    await sidebar.locator(`nav a[href="${path}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(sidebar).toHaveAttribute("data-persistence-check", "original");
    await expect(sidebar).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
  }
});
