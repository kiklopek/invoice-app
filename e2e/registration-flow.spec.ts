import { expect, test, type Page } from "@playwright/test";
import { getDictionary } from "../src/i18n/dictionaries";

// All auth mutations are intercepted: these checks never create an account,
// send an e-mail or consume a real invitation.
const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "founder@example.org", identities: [{ id: "identity-1" }], created_at: "2026-01-01T00:00:00Z" };
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test-signature`;

async function fillRegistration(page: Page, locale: "cs" | "en") {
  const common = getDictionary(locale).auth.common;
  await page.getByLabel(common.fullName, { exact: true }).fill("Jana Nováková");
  await page.getByLabel(common.companyEmail, { exact: true }).fill(user.email);
  await page.getByLabel(common.password, { exact: true }).fill("Silne-Heslo-2026");
  await page.getByLabel(common.passwordAgain, { exact: true }).fill("Silne-Heslo-2026");
  await page.locator('input[type="checkbox"]').check();
}

for (const locale of ["cs", "en"] as const) {
  const copy = getDictionary(locale).auth.register;

  for (const mode of ["confirmation", "session", "offline"] as const) {
    test(`${locale}: founder registration handles ${mode}`, async ({ page }, testInfo) => {
      await page.context().addCookies([{ name: "splatno-lang", value: locale, url: "http://127.0.0.1:3000" }]);
      const bootstrapCalls: string[] = [];
      await page.route("**/api/auth/registration-access", async (route) => {
        if (mode === "offline") await route.abort();
        else await route.fulfill({ json: { allowed: true, kind: "signup" } });
      });
      await page.route("**/auth/v1/**", async (route) => {
        const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, GET, OPTIONS" };
        if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
        expect(new URL(route.request().url()).pathname).toBe("/auth/v1/signup");
        const json = mode === "session"
          ? { access_token: token, refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, user }
          : user;
        await route.fulfill({ json, headers });
      });
      for (const path of ["access", "session-preference"]) {
        await page.route(`**/api/auth/${path}`, async (route) => {
          expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
          bootstrapCalls.push(path);
          await route.fulfill({ json: path === "access" ? { allowed: true, needsOnboarding: true, mfa_bypassed: false } : { saved: true } });
        });
      }
      await page.route("**/mfa?**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Verification destination</h1>" }));
      await page.goto("/register");
      await expect(page.getByText(copy.invitationHint)).toBeVisible();
      if (mode === "confirmation") {
        for (const width of [320, 768, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
          const screenshotPath = testInfo.outputPath(`registration-${width}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true });
          await testInfo.attach(`registration-${width}`, { path: screenshotPath, contentType: "image/png" });
        }
      }
      await fillRegistration(page, locale);
      await page.getByRole("button", { name: copy.submit, exact: true }).click();
      if (mode === "confirmation") {
        await expect(page.getByText(copy.sentTitle, { exact: true })).toBeVisible();
        expect(bootstrapCalls).toEqual([]);
      } else if (mode === "session") {
        await expect(page).toHaveURL(/\/mfa\?returnTo=%2Fonboarding$/);
        expect(bootstrapCalls).toEqual(["access", "session-preference"]);
      } else {
        await expect(page.getByText(copy.errors.connection)).toBeVisible();
        await expect(page.getByRole("button", { name: copy.submit, exact: true })).toBeEnabled();
      }
    });
  }
}
