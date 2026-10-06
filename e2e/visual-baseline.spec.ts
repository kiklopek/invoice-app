import { expect, test, type Page } from "@playwright/test";
import { requireWorkspaceSession } from "./session";

// Vizuální baseline pro refaktor CSS (F3B).
//
// Proč to existuje: `minimal.css` má 3 418 řádků a chystá se jeho rozdělení,
// sjednocení tokenů a redukce jedenácti breakpointů na čtyři. Bez snímků je
// každý takový zásah slepý -- kaskáda se dá rozbít způsobem, který žádný
// jednotkový test nezachytí, protože ten vidí jen text souboru.
//
// Snímky se pořizují v ustáleném stavu: animace vypnuté a data z reálné
// databáze. Proto se porovnává s tolerancí -- cílem je zachytit posun
// rozvržení, ne rozdíl jednoho pixelu v antialiasingu.
// Stav baseline (22. 9., aktualizováno po ověření):
// Snímky odpovídají stavu PO zavedení tokenů a typografické škály
// (src/app/styles/). Předchozí sada byla pořízená před nimi a lišila se
// o 30 px na výšku stránky. Ověřeno, že jde o ZÁMĚR, ne regresi:
// base.css nastavuje jednotný line-height a tokens.css typografii v rem
// s minimem 12 px. Vizuálně porovnáno, výsledek je čitelnější.
//
// Při další změně CSS se snímky aktualizují až po prohlédnutí rozdílu,
// ne automaticky -- jinak by test jen potvrzoval, co se právě stalo.
// `networkidle` na dev serveru nestačí: SWR se ptá až po hydrataci, takže
// snímek občas zachytil „Načítám archiv…“ místo dat a baseline byla k ničemu
// (ověřeno 6. 10. -- pět stránek se lišilo bez jediné změny kódu). Čeká se
// proto, až zmizí každý viditelný indikátor načítání A stránka se přestane
// měnit. Samotná absence textu nestačí: archiv ho ze serveru nevykreslí
// vůbec, „Načítám…“ se objeví až po hydrataci.
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  const snapshot = () => page.evaluate(() => {
    const busy = document.querySelector('[aria-busy="true"], .page-loading, .app-loading');
    const text = document.body.innerText;
    const loading = Boolean(busy) || /Načítám|Načítání/.test(text);
    return { loading, signature: `${document.documentElement.scrollHeight}:${text.length}` };
  });
  let previous = "";
  let stableSince = 0;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { loading, signature } = await snapshot();
    if (loading || signature !== previous) {
      previous = signature;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 800) {
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("Stránka se do 30 s neustálila (stále načítá nebo se mění).");
}

// Dev server pod souběžnou zátěží občas ukáže vlastní chybový overlay
// („Unexpected end of JSON input“). Takový snímek nesmí skončit jako
// baseline -- test raději spadne a pustí se znovu.
async function assertNoDevOverlay(page: Page) {
  const overlay = await page.evaluate(() => {
    const portal = document.querySelector("nextjs-portal");
    const root = portal?.shadowRoot;
    return Boolean(root?.querySelector("[data-nextjs-dialog]"));
  });
  expect(overlay, "Na stránce je chybový overlay Next.js dev serveru").toBe(false);
}

const PAGES = [
  { path: "/dashboard", name: "prehled" },
  { path: "/invoices", name: "faktury" },
  { path: "/invoices/new", name: "nova-faktura" },
  { path: "/invoices/import", name: "import" },
  { path: "/invoices/payments", name: "platby" },
  { path: "/invoices/archive", name: "archiv" },
  { path: "/customers", name: "zakaznici" },
  { path: "/reports", name: "reporty" },
  { path: "/reminders", name: "upominky" },
  { path: "/settings", name: "nastaveni" },
];

test.describe("vizuální baseline", () => {
  test.beforeEach(async ({ page }) => {
    // Bez tohohle by se snímky lišily podle toho, kde zrovna byla animace.
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const { path, name } of PAGES) {
    test(`${name} vypadá stejně jako v baseline`, async ({ page }) => {
      await page.goto(path);
      if (await requireWorkspaceSession(page, `baseline ${path}`)) return;
      // Ustálení: data dotečou přes SWR až po prvním vykreslení.
      await settle(page);
      await assertNoDevOverlay(page);
      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
        animations: "disabled",
      });
    });
  }

  // Malý notebook (1024) a široký monitor (1440) nepokrývá žádný projekt
  // v playwright.config.ts. Přidávat je jako projekty by zdvojnásobilo celou
  // sadu, proto se nastavují ručně a jen v jednom prohlížeči.
  for (const viewport of [{ width: 1024, height: 768, name: "laptop" }, { width: 1440, height: 900, name: "wide" }]) {
    for (const { path, name } of PAGES) {
      test(`${name} vypadá stejně jako v baseline (${viewport.name})`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "desktop", "Šířka se nastavuje ručně, stačí jeden prohlížeč");
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(path);
        if (await requireWorkspaceSession(page, `baseline ${path} ${viewport.name}`)) return;
        await settle(page);
        await assertNoDevOverlay(page);
        await expect(page).toHaveScreenshot(`${name}-${viewport.name}.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.01,
          animations: "disabled",
        });
      });
    }
  }

  test("tiskový vzhled reportu zůstává stejný", async ({ page }, testInfo) => {
    // Tisk má smysl porovnávat jen v jedné šířce; A4 je pevná.
    test.skip(testInfo.project.name !== "desktop", "Tisk se měří jen jednou");
    await page.goto("/reports");
    if (await requireWorkspaceSession(page, "baseline tisku")) return;
    await page.emulateMedia({ media: "print" });
    await settle(page);
    await assertNoDevOverlay(page);
    await expect(page).toHaveScreenshot("reporty-tisk.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    });
  });
});
