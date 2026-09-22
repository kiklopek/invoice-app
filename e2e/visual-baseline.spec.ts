import { expect, test } from "@playwright/test";
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
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
        animations: "disabled",
      });
    });
  }

  test("tiskový vzhled reportu zůstává stejný", async ({ page }, testInfo) => {
    // Tisk má smysl porovnávat jen v jedné šířce; A4 je pevná.
    test.skip(testInfo.project.name !== "desktop", "Tisk se měří jen jednou");
    await page.goto("/reports");
    if (await requireWorkspaceSession(page, "baseline tisku")) return;
    await page.emulateMedia({ media: "print" });
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("reporty-tisk.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    });
  });
});
