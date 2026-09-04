import { expect, test } from "@playwright/test";

test("staging password login reaches the email MFA step", async ({ page }) => {
  test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, "Requires isolated Supabase staging credentials");
  await page.goto("/login");
  await page.getByLabel("Firemní e-mail").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Heslo").fill(process.env.E2E_PASSWORD!);
  await page.getByLabel(/Zapamatovat si mě/).check();
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page).toHaveURL(/\/mfa$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ověření");
});
