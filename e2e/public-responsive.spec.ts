import { expect, test } from "@playwright/test";

// Veřejné stránky (landing, přihlášení, registrace, pozvánka, právní texty)
// na šířkách od nejmenšího telefonu po desktop a na telefonu na šířku.
// Hlídá to, co se na nich rozbíjí nejčastěji: vodorovné přetékání, hlavní
// tlačítko mimo obrazovku a vstupy s písmem pod 16 px (iOS je pak při
// psaní přibližuje).

test.use({ storageState: { cookies: [], origins: [] } });

const PAGES: { path: string; action: RegExp }[] = [
  { path: "/", action: /Vyzkoušet/ },
  { path: "/login", action: /Přihlásit se/ },
  { path: "/hlavica", action: /Přihlásit se/ },
  { path: "/register", action: /Vytvořit účet/ },
  { path: "/hlavica/registrace", action: /Pokračovat|Vytvořit účet|Ověřit/ },
  { path: "/forgot-password", action: /Poslat|Odeslat|Obnovit/ },
  { path: "/pozvanka/neplatny-odkaz", action: /Přihlásit se/ },
  { path: "/podminky", action: /splatno/ },
  { path: "/ochrana-osobnich-udaju", action: /splatno/ },
];

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
  { width: 667, height: 375 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 900 },
];

for (const { path, action } of PAGES) {
  test(`${path} drží rozvržení na všech šířkách`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Šířky se nastavují ručně, stačí jeden prohlížeč");
    await page.goto(path);
    await page.waitForLoadState("networkidle");

    const problems: string[] = [];
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        smallInputs: [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea")]
          .filter((input) => getComputedStyle(input).display !== "none" && parseFloat(getComputedStyle(input).fontSize) < 16)
          .map((input) => input.getAttribute("name") ?? input.getAttribute("type") ?? input.tagName),
      }));
      if (state.overflow > 1) problems.push(`${viewport.width}px: přetéká o ${state.overflow}px`);
      if (state.smallInputs.length) problems.push(`${viewport.width}px: vstup pod 16 px (${state.smallInputs.join(", ")})`);

      const main = page.getByRole("link", { name: action }).or(page.getByRole("button", { name: action })).first();
      const box = await main.boundingBox();
      if (!box) problems.push(`${viewport.width}px: hlavní akce ${action} není vidět`);
      else if (box.x < 0 || box.x + box.width > viewport.width + 1) problems.push(`${viewport.width}px: hlavní akce ${action} je mimo obrazovku`);
    }
    expect(problems).toEqual([]);
  });
}
