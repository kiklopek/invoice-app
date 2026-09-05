import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/invoices");
  test.skip(page.url().includes("/login"), "Requires a demo or authenticated test session");
  await expect(page.locator('.sidebar nav a[href="/invoices"]')).toBeVisible();
});

test("Back preserves a draft and explicit discard keeps the shell mounted", async ({ page }) => {
  await page.locator('.sidebar').evaluate(el => el.setAttribute('data-test-shell', 'original'));
  await page.locator('a[href="/invoices/new"]').first().click();
  const number = page.getByPlaceholder("např. FV-2026-001");
  await number.fill("AUDIT-RESTORED-DRAFT");
  await page.goBack();
  await page.locator('a[href="/invoices/new"]').first().click();
  await expect(number).toHaveValue("AUDIT-RESTORED-DRAFT");
  await page.locator('.sidebar nav a[href="/invoices"]').click();
  await page.getByRole('button', { name: 'Zrušit', exact: true }).click();
  await expect(number).toHaveValue("AUDIT-RESTORED-DRAFT");
  await page.locator('.sidebar nav a[href="/invoices"]').click();
  await page.getByRole('button', { name: 'Opustit stránku', exact: true }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await expect(page.locator('.sidebar')).toHaveAttribute('data-test-shell', 'original');
  await page.locator('a[href="/invoices/new"]').first().click();
  await expect(number).toHaveValue("");
});

test("invoice detail preserves the overall count and Escape closes payment confirmation", async ({ page }) => {
  const count = await page.locator('.sidebar em').textContent();
  await page.locator('tbody tr').first().click();
  await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
  await expect(page.getByRole('button', { name: 'Potvrdit úhradu', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar em')).toHaveText(count!);
  await page.getByRole('button', { name: 'Potvrdit úhradu', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test("Escape also closes payment confirmation from the invoice list", async ({ page }) => {
  await page.getByRole('button', { name: 'Potvrdit úhradu', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
