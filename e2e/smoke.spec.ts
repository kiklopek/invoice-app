import { expect, test } from "@playwright/test";
import { requireWorkspaceSession, skipWithDesktopNavigation, skipWithoutDesktopNavigation } from "./session";

test("dashboard loads without browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/dashboard");
  if (await requireWorkspaceSession(page, "dashboard bez chyb v konzoli")) return;
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Finanční přehled");
  expect(errors).toEqual([]);
});

test("mobile layout does not overflow horizontally", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only viewport assertion");
  await page.goto("/dashboard");
  const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1);
});

test("sidebar stays mounted while navigating between workspace pages", async ({ page }, testInfo) => {
  // Na úzkém displeji žádný postranní panel není; navigaci tam ověřuje test níže.
  skipWithoutDesktopNavigation(testInfo);
  await page.goto("/dashboard");
  if (await requireWorkspaceSession(page, "sidebar zůstává připojený")) return;
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

// Tyhle testy ověřují chování BEZ přihlášení. Od chvíle, kdy global-setup
// vytváří skutečnou session, by jinak běžely přihlášené a měřily nesmysl.
test.describe("odhlášený uživatel", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("login page is usable without an authenticated session", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Přihlášení");
    await expect(page.getByLabel("Firemní e-mail")).toBeVisible();
    await expect(page.getByLabel("Heslo")).toBeVisible();
  });
  test("an unauthenticated workspace visit lands on login and remembers where it was heading", async ({ page }) => {
    // /customers driv v proxy matcheru chybelo, takze nepřihlaseny uzivatel
    // nedostal redirect na /login, ale spadl az v page-data loaderu do obecne
    // chybove stranky s tlacitkem "Zpet na prehled", ktere vedlo na stejnou
    // chybu -- nekonecna smycka. A returnTo se generovalo, ale nikdo ho necetl.
    const response = await page.goto("/customers");
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fcustomers$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Přihlášení");
  });
  test("login refuses a returnTo that would leave the site", async ({ page }) => {
    await page.goto("/login?returnTo=https%3A%2F%2Fevil.example");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Přihlášení");
    // Otevreny redirect: stranka se nesmi nikam odnavigovat uz pri nacteni.
    await expect(page).toHaveURL(/\/login/);
  });
});

test("mobilní navigace se otevře, projde a zase zavře", async ({ page }, testInfo) => {
  skipWithDesktopNavigation(testInfo);
  await page.goto("/invoices");
  if (await requireWorkspaceSession(page, "mobilní navigace")) return;

  // Pozor: `.sidebar` je společný kontejner -- mobilní lišta žije uvnitř něj,
  // takže samotný `.sidebar` skrytý NENÍ a tvrdit to by byl omyl. Skrytá má
  // být desktopová navigace v něm.
  await expect(page.locator(".sidebar .desktop-navigation")).toBeHidden();

  const toggle = page.locator(".mobile-navigation-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const panel = page.locator("#mobile-navigation-panel");
  await expect(panel).toBeVisible();

  // Cíl z menu musí skutečně navigovat.
  await panel.locator('a[href="/reports"]').first().click();
  await expect(page).toHaveURL(/\/reports$/);
  // A menu se po přechodu zavře samo, jinak by zůstalo přes obsah.
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("na úzkém displeji se nic nepřetéká do stran", async ({ page }, testInfo) => {
  skipWithDesktopNavigation(testInfo);
  for (const path of ["/dashboard", "/invoices", "/reports", "/customers", "/reminders", "/settings"]) {
    await page.goto(path);
    if (page.url().includes("/login")) return;
    const sizes = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(sizes.scroll, `${path} přetéká do stran`).toBeLessThanOrEqual(sizes.width + 1);
  }
});
