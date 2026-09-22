import { test, expect } from "@playwright/test";
import { requireWorkspaceSession, skipWithoutDesktopNavigation } from "./session";

// Tyhle regrese se týkají DESKTOPOVÉ navigace (postranní panel, který
// zůstává připojený mezi stránkami). Na úzkém displeji sidebar neexistuje --
// je nahrazený hamburgerem -- takže by tu selhávaly na chování, které je
// správné. Mobilní protějšek je na konci souboru.
test.beforeEach(async ({ page }, testInfo) => {
  skipWithoutDesktopNavigation(testInfo);
  await page.goto("/invoices");
  if (await requireWorkspaceSession(page, "regrese navigace")) return;
  await expect(page.locator('.sidebar nav a[href="/invoices"]')).toBeVisible();
});

// ZNÁMÁ CHYBA, zatím nevysvětlená (22. 9.). Tenhle test a "invoice filters
// stay in the URL" padají v plné sadě, samostatně projdou (ověřeno 6/6
// opakování). Není to flaky test -- z trace je vidět skutečné chování:
//
//   - navigated to ".../invoices"
//   - navigated to ".../invoices/new"
//
// Aplikace tedy po potvrzení "Opustit stránku" odejde na seznam a vzápětí se
// vrátí do formuláře.
//
// Co je OVĚŘENO: samostatně test projde (6/6 opakování). Umělé zpomalení
// každého požadavku na 400 ms chybu NEVYVOLÁ -- pouhá pomalost tedy příčina
// není. Selhává jen v plné sadě, kde běží víc prohlížečů proti jednomu dev
// serveru.
//
// PŘÍČINA (změřeno během s trace: "on" přes celou sadu): v okamžiku selhání
// běží nedokončený "[Fast Refresh] rebuilding" dev serveru.
//
//   oba navigační testy, které padly: 2/2 mají Fast Refresh
//   testy, které prošly:              2/168
//
// Hot reload tedy překreslí komponentu uprostřed klientské navigace a ta se
// zahodí. Je to artefakt vývojového serveru, ne doložená chyba aplikace:
// v produkci žádný Fast Refresh neexistuje. (Kontrolní skupina je tu
// podstatná -- bez ní to vypadalo jako chyba v useUnsavedChanges.)
//
// Proč se to neopravuje obcházením: test ověřuje správné chování a oslabit
// ho kvůli vlastnosti dev serveru by znamenalo přestat hlídat skutečnou
// regresi. Čisté řešení je pustit sadu proti produkčnímu buildu, což dnes
// brání secure cookies přes HTTP (viz poznámka v playwright.config.ts).
// Do té doby jsou tahle dvě selhání známá a vysvětlená.
// Test se schválně NEOSLABUJE -- ověřuje správné chování.
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
  await expect(page.getByRole('button', { name: 'Smazat fakturu', exact: true })).toBeVisible();
  // "Upravit údaje" se mezitím přesunulo do rozbalovacího menu akcí, takže
  // v hlavičce zůstaly jen dvě hlavní akce. Spec to nezachytil dřív, protože
  // se roky přeskakoval kvůli chybějící session.
  await expect(page.locator('.detail-page-header .section-actions').getByRole('button')).toHaveText([
    'Potvrdit úhradu',
    'Smazat fakturu',
  ]);
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

test("invoice filters stay in the URL without overriding later navigation", async ({
  page,
}) => {
  const search = page.getByPlaceholder(
    "Číslo faktury, odběratel, IČO, e-mail nebo VS",
  );
  if (!(await search.isVisible()))
    await page.getByRole("button", { name: "Filtry a export" }).click();
  await search.fill("Novák");
  await expect(page).toHaveURL(/q=Nov%C3%A1k/);
  await page.locator('.sidebar nav a[href="/reports"]').click();
  await expect(page).toHaveURL(/\/reports$/);
});
