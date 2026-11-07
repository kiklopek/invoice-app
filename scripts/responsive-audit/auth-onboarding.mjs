import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit, expect } from "@playwright/test";
import { fixtures, NOW } from "./fixtures.mjs";
import { startHarness, installNetwork } from "./harness.mjs";

const local = process.argv.includes("--local");
const source = local
  ? process.cwd()
  : "/tmp/splatno-responsive-production-26defdc";
const out = resolve(
  local
    ? "artifacts/entry-layout-2026-11-02/states"
    : "artifacts/responsive-audit/2026-11-02/auth-onboarding",
);
await mkdir(out, { recursive: true });
const engine = process.argv.includes("--engine=webkit") ? "webkit" : "chromium";
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const browser = await { chromium, webkit }[engine].launch();
const harness = await startHarness(
  source,
  "auth-onboarding-" + engine + (local ? "-local" : ""),
  4379,
);
const resultFile = resolve(out, `results-${engine}.json`);
const results = process.argv.includes("--resume")
  ? JSON.parse(await readFile(resultFile, "utf8")).filter(
      (r) => r.status === "observed",
    )
  : [];
const password = "Synthetic-Only-928!";
const longEmail = "velmi.dlouha.kontaktni.adresa.pro.testovani@example.invalid";
const invitation = {
  status: "valid",
  email: longEmail,
  role: "accounting",
  companyName:
    "Ukázková společnost s dlouhým názvem pro kontrolu zalamování s.r.o.",
  companyLogo: null,
  expiresAt: "2026-11-30T08:00:00Z",
};
const cases = [];
for (let step = 1; step <= 8; step++)
  cases.push({
    id: "onboarding-step-" + step,
    route: "/onboarding",
    step,
    widths: [320, 768, 1440, 2560],
  });
for (const id of [
  "login-error",
  "register-code-error",
  "forgot-sent",
  "reset-error",
  "mfa-code-error",
  "tenant-login",
  "tenant-register",
  "invitation-new",
  "invitation-expired",
  "invitation-other",
])
  cases.push({
    id,
    route: id.startsWith("invitation")
      ? "/pozvanka/audit"
      : id === "tenant-login"
        ? "/login"
        : id === "tenant-register"
          ? "/register"
          : id.startsWith("login")
            ? "/login"
            : id.startsWith("register")
              ? "/register"
              : id.startsWith("forgot")
                ? "/forgot-password"
                : id.startsWith("reset")
                  ? "/reset-password"
                  : "/mfa",
    widths: [390, 1024],
  });
cases.push({
  id: "onboarding-draft-retained",
  route: "/onboarding",
  step: 2,
  widths: [390, 1024],
});
async function completeRegistration(page) {
  await page.locator("input[autocomplete=name]").fill("Ukázkový uživatel");
  await page.locator("input[type=email]").fill(longEmail);
  await page.locator("input[type=password]").nth(0).fill(password);
  await page.locator("input[type=password]").nth(1).fill(password);
  await page.locator("input[type=checkbox]").check();
  await page.locator("button[type=submit]").click();
  await expect(page.locator("input[autocomplete=one-time-code]")).toBeVisible();
}
try {
  for (const item of cases.filter((c) => !only || c.id === only))
    for (const width of item.widths) {
      if (
        results.some(
          (r) =>
            r.id === item.id && r.width === width && r.status === "observed",
        )
      )
        continue;
      const context = await browser.newContext({
        viewport: {
          width,
          height: width === 320 ? 600 : local && width >= 2560 ? 1817 : 800,
        },
        locale: "cs-CZ",
        timezoneId: "Europe/Prague",
        hasTouch: width < 1000,
        isMobile: width < 1000,
        reducedMotion: "reduce",
      });
      const page = await context.newPage(),
        requests = [],
        errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      const data = await fixtures(source);
      if (item.step) {
        data.onboardingDraft = {
          version: 1,
          step: Math.min(7, item.step),
          reached: 7,
          updatedAt: Date.parse(NOW),
          company: {
            name: "Ukázková firma pro kontrolu dlouhého názvu s.r.o.",
            ico: "",
            dic: "",
            registered_address: "Ukázková 123, Praha 110 00",
            operating_address: "",
            data_box_id: "",
            phone: "+420777123456",
            email: longEmail,
            bank_account_czk: "123456789/0100",
            bank_account_eur: "",
          },
          vatPayer: false,
          invites: [{ email: longEmail, role: "accounting" }],
          reminders: { days: [-3, 0, 7, 14], replyTo: longEmail, ccText: "" },
          inviteEmail: "",
          inviteRole: "accounting",
          logo: null,
        };
        if (item.step === 8)
          data.onboardingPayment = {
            companyName: data.onboardingDraft.company.name,
            canManage: true,
            plan: null,
            period: null,
          };
      }
      if (item.id.startsWith("tenant")) data.authBrand = "hlavica";
      data.invitation =
        item.id === "invitation-expired" ? { status: "expired" } : invitation;
      if (item.id === "invitation-other")
        data.signedInAs = "jiny.ucet@example.invalid";
      await page.clock.setFixedTime(new Date(NOW));
      await page.addInitScript((d) => {
        window.__AUDIT_DATA__ = d;
      }, data);
      await installNetwork(page, data, "normal", requests);
      await page.route("**/api/**", async (route) => {
        const req = route.request(),
          p = new URL(req.url()).pathname;
        let json,
          status = 200;
        if (p === "/api/onboarding/draft")
          json = { draft: data.onboardingDraft || null };
        else if (p === "/api/auth/registration-access")
          json = { allowed: true };
        else if (p === "/api/auth/register") {
          const body = req.postDataJSON();
          if (body.action === "verify") {
            status = 400;
            json = { code: "invalid_code" };
          } else json = { sent: true };
        } else if (p === "/api/auth/password-recovery") json = { sent: true };
        else if (p === "/api/auth/email-mfa/verify") {
          status = 400;
          json = { code: "invalid_code" };
        } else return route.fallback();
        requests.push({
          method: req.method(),
          path: p,
          synthetic: true,
          status,
        });
        return route.fulfill({ status, json });
      });
      const result = {
        id: item.id,
        route: item.route,
        engine,
        width,
        height: width === 320 ? 600 : local && width >= 2560 ? 1817 : 800,
        sourceCommit: local
          ? "current-worktree"
          : "26defdcc90f9ebaf979d40d23a6c5c7648dd0e0f",
        status: "failed",
      };
      try {
        await page.goto(harness.url + item.route);
        await page.locator("h1").first().waitFor();
        await expect(page.locator("[data-audit-error]")).toHaveCount(0);
        if (item.id === "login-error") {
          await page.locator("input[type=email]").fill(longEmail);
          await page.locator("input[type=password]").fill(password);
          await page
            .getByRole("button", { name: "Zobrazit heslo", exact: true })
            .click();
          await expect(
            page.locator("input[autocomplete=current-password]"),
          ).toHaveAttribute("type", "text");
          await page.locator("button[type=submit]").click();
          await expect(page.locator("input[type=email]")).toHaveValue(
            longEmail,
          );
          await expect(
            page.getByText(/E-mail nebo heslo není správné/).first(),
          ).toBeVisible();
        }
        if (item.id === "register-code-error") {
          await completeRegistration(page);
          await page
            .locator("input[autocomplete=one-time-code]")
            .fill("123456");
          await page.locator("button[type=submit]").click();
          await expect(page.getByRole("alert")).toBeVisible();
        }
        if (item.id === "forgot-sent") {
          await page.locator("input[type=email]").fill(longEmail);
          await page.locator("button[type=submit]").click();
          await expect(
            page.locator("b").filter({ hasText: longEmail }),
          ).toBeVisible();
          await expect(page.locator("input[type=email]")).toHaveCount(0);
        }
        if (item.id === "reset-error") {
          await page.locator("input[type=password]").nth(0).fill(password);
          await page.locator("input[type=password]").nth(1).fill(password);
          await page.locator("button[type=submit]").click();
          await expect(
            page.getByText(/nepodařilo|nepodařila|nelze/i).first(),
          ).toBeVisible();
        }
        if (item.id === "mfa-code-error") {
          await page
            .locator("input[autocomplete=one-time-code]")
            .fill("123456");
          await page.locator("button[type=submit]").click();
          await expect(
            page.locator("[role=alert], [class*=error]").first(),
          ).toBeVisible();
        }
        if (item.step) {
          const titles = [
            "Řekněte nám o vaší firmě",
            "Kam vám mají zákazníci psát?",
            "Kam vám chodí platby?",
            "Kdy připomenout neuhrazenou fakturu?",
            "Logo vaší firmy",
            "Pozvěte kolegy",
            "Zkontrolujte a spusťte",
            "Vyberte tarif",
          ];
          await expect(page.locator("h1")).toContainText(titles[item.step - 1]);
        }
        if (item.id === "onboarding-draft-retained") {
          await page
            .locator("input[type=email]")
            .first()
            .fill("rozepsano@example.invalid");
          await page.locator("button[form=onboarding-step-form]").click();
          await expect(page.locator("h1")).toContainText(
            "Kam vám chodí platby?",
          );
          await page.getByRole("button", { name: "Zpět", exact: true }).click();
          await expect(page.locator("input[type=email]").first()).toHaveValue(
            "rozepsano@example.invalid",
          );
          await page.setViewportSize({
            width: width === 390 ? 1024 : 390,
            height: 800,
          });
          await expect(page.locator("input[type=email]").first()).toHaveValue(
            "rozepsano@example.invalid",
          );
          await page.setViewportSize({ width, height: 800 });
          result.draftRetainedAcrossStepsAndResize = true;
        }
        if (item.id === "invitation-other")
          await expect(
            page.getByRole("button", { name: /Odhlásit/i }),
          ).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        result.metrics = await page.evaluate(() => {
          const rect = (e) => {
            const r = e.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          };
          const main = document.querySelector("main"),
            card = main?.firstElementChild,
            h1 = document.querySelector("h1");
          const visible = (e) => {
            const r = e.getBoundingClientRect();
            return (
              r.width > 2 &&
              r.height > 2 &&
              getComputedStyle(e).visibility !== "hidden"
            );
          };
          const measure = (e) => ({
            text: e.textContent?.trim().slice(0, 65),
            rect: rect(e),
            font: getComputedStyle(e).fontSize,
          });
          return {
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
            documentHeight: document.documentElement.scrollHeight,
            documentOverflow:
              document.documentElement.scrollWidth > innerWidth + 1,
            main: main ? rect(main) : null,
            card: card ? rect(card) : null,
            title: h1 ? measure(h1) : null,
            controls: [
              ...document.querySelectorAll(
                "button[type=submit],button[form],input:not([type=checkbox]):not([type=radio]):not([type=file])",
              ),
            ]
              .filter(visible)
              .map(measure),
            scrollers: [...document.querySelectorAll("main *")]
              .filter(
                (e) =>
                  visible(e) &&
                  e.scrollHeight > e.clientHeight + 2 &&
                  /auto|scroll/.test(getComputedStyle(e).overflowY),
              )
              .map((e) => ({
                rect: rect(e),
                clientHeight: e.clientHeight,
                scrollHeight: e.scrollHeight,
              })),
            statusMessages: [
              ...document.querySelectorAll("[role=alert],[role=status]"),
            ]
              .filter(visible)
              .map((e) => e.textContent?.trim()),
          };
        });
        expect(errors).toEqual([]);
        expect(result.metrics.documentOverflow).toBe(false);
        for (const button of await page
          .locator("button[type=submit], button[form]")
          .all())
          if (await button.isVisible()) {
            await button.scrollIntoViewIfNeeded();
            const box = await button.boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(-1);
            expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
            expect(box.y).toBeGreaterThanOrEqual(-1);
            expect(box.y + box.height).toBeLessThanOrEqual(result.height + 1);
          }
        const shot = `${engine}-${item.id}-${width}.png`;
        await page.screenshot({
          path: resolve(out, shot),
          fullPage: true,
          animations: "disabled",
        });
        result.screenshot = shot;
        result.status = "observed";
      } catch (e) {
        result.failure = String(e);
        await page
          .screenshot({
            path: resolve(out, `${engine}-${item.id}-${width}-failed.png`),
            fullPage: true,
          })
          .catch(() => {});
      }
      result.requests = requests;
      result.pageErrors = errors;
      results.push(result);
      await writeFile(resultFile, JSON.stringify(results, null, 2));
      console.log(
        `${engine} ${item.id} ${width}: ${result.status}${result.failure ? " " + result.failure : ""}`,
      );
      await context.close();
      if (result.status === "failed") {
        process.exitCode = 1;
        break;
      }
    }
} finally {
  await browser.close();
  await harness.server.close();
}
