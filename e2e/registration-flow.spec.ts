import { expect, test, type Page } from "@playwright/test";
import { getDictionary } from "../src/i18n/dictionaries";

// All auth mutations are intercepted: these checks never create an account,
// send an e-mail or consume a real invitation.
const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "founder@example.org", identities: [{ id: "identity-1" }], created_at: "2026-01-01T00:00:00Z" };


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

  for (const mode of ["code", "delivery_failure", "offline"] as const) {
    test(`${locale}: founder registration handles ${mode}`, async ({ page }, testInfo) => {
      await page.context().addCookies([{ name: "splatno-lang", value: locale, url: "http://127.0.0.1:3000" }]);
      await page.clock.install();
      const calls: string[] = [];
      await page.route("**/api/auth/registration-access", async (route) => {
        if (mode === "offline") await route.abort();
        else await route.fulfill({ json: { allowed: true, kind: "signup" } });
      });
      // Signup never calls Supabase's link-sending endpoint in the browser.
      await page.route("**/auth/v1/**", () => { throw new Error("Unexpected client auth request"); });
      await page.route("**/api/auth/register", async route => {
        const body = route.request().postDataJSON();
        calls.push(body.action);
        expect(body.email).toBe(user.email);
        expect(body.password).toBe("Silne-Heslo-2026");
        if (mode === "delivery_failure") return route.fulfill({ status: 503, json: { code: "email_delivery_failed" } });
        if (body.action === "send") return route.fulfill({ json: { sent: true } });
        if (body.code !== "A7K9B") return route.fulfill({ status: 400, json: { code: "invalid_code" } });
        return route.fulfill({ json: { verified: true, redirect: "/onboarding" } });
      });
      await page.route("**/onboarding", route => route.fulfill({ contentType: "text/html", body: "<h1>Company setup</h1>" }));
      await page.goto("/register");
      await expect(page.getByText(copy.invitationHint)).toBeVisible();
      await fillRegistration(page, locale);
      await page.getByRole("button", { name: copy.submit, exact: true }).click();
      if (mode === "code") {
        await expect(page.getByText(copy.sentTitle, { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: copy.verifyCode, exact: true })).toBeDisabled();
        const fields = page.getByRole("group", { name: copy.codeLabel, exact: true }).locator("input");
        // This macOS WebKit harness crashes in its native OTP autofill popover.
        // Exercise paste/focus/verification with the native popover disabled.
        if (testInfo.project.name === "webkit") await fields.evaluateAll(elements => elements.forEach(element => {
          element.setAttribute("autocomplete", "off");
          // Avoid the harness's broken native selection bridge. Chromium
          // exercises real focus; WebKit still exercises paste and form state.
          (element as HTMLInputElement).focus = () => {};
          (element as HTMLInputElement).select = () => {};
        }));
        for (const width of [320, 768, 1440]) {
          await page.getByRole("heading", { level: 1 }).click();
          await page.setViewportSize({ width, height: 1000 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
          await page.screenshot({ path: testInfo.outputPath(`registration-code-${width}.png`), fullPage: true });
        }
        await expect(fields).toHaveCount(5);
        const input = fields.first();
        await input.evaluate((element, value) => { const clipboard = new DataTransfer(); clipboard.setData("text/plain", value); element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true })); }, "B8M2C");
        for (const [index, digit] of [..."B8M2C"].entries()) await expect(fields.nth(index)).toHaveValue(digit);
        await page.getByRole("button", { name: copy.verifyCode, exact: true }).click();
        await expect(page.getByText(copy.errors.code, { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: copy.verifyCode, exact: true })).toBeEnabled();
        await page.clock.fastForward(61_000);
        await page.getByRole("button", { name: copy.resendCode, exact: true }).click();
        for (let index = 0; index < 5; index++) await expect(fields.nth(index)).toHaveValue("");
        await input.evaluate((element, value) => { const clipboard = new DataTransfer(); clipboard.setData("text/plain", value); element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true })); }, "a7k9b");
        await page.getByRole("button", { name: copy.verifyCode, exact: true }).click();
        await expect(page).toHaveURL(/\/onboarding$/);
        expect(calls).toEqual(["send", "verify", "send", "verify"]);
      } else {
        await expect(page.getByText(mode === "offline" ? copy.errors.connection : copy.errors.emailDelivery)).toBeVisible();
        await expect(page.getByRole("button", { name: copy.submit, exact: true })).toBeEnabled();
      }
    });
  }
}
