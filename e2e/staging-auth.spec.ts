import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("staging password login reaches the email MFA step", async ({ page }) => {
  test.skip(!process.env.E2E_MFA_EMAIL || !process.env.E2E_MFA_PASSWORD, "Requires ordinary isolated Supabase MFA credentials");
  await page.goto("/login");
  await page.getByLabel("Firemní e-mail").fill(process.env.E2E_MFA_EMAIL!);
  await page.getByLabel("Heslo").fill(process.env.E2E_MFA_PASSWORD!);
  await page.getByLabel(/Zapamatovat si mě/).check();
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page).toHaveURL(/\/mfa(?:\?|$)/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ověření");
});
