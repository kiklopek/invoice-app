import { expect, test } from "@playwright/test";
import { requireWorkspaceSession } from "./session";

// Tabulky jsou v téhle aplikaci to hlavní a na úzkém displeji byly nejslabší
// místo: dvě z nich (odblokování e-mailů a účetní tabulky reportu) neměly
// mobilní pravidla vůbec a četly se přes vodorovný posuv o šířce 620 až
// 760 px v okně širokém 360 px.
//
// Test hlídá výsledek, ne konkrétní CSS: žádná tabulka nesmí nutit
// k posouvání do stran a řádky se musí číst jako označené karty.

const TABLES: Array<{ path: string; name: string; selector: string; open?: (page: import("@playwright/test").Page) => Promise<void> }> = [
  { path: "/invoices", name: "seznam faktur", selector: ".invoice-list-table" },
  { path: "/invoices/archive", name: "archiv faktur", selector: ".archive-invoice-table" },
  { path: "/customers", name: "zákazníci", selector: ".customers-list-table" },
  { path: "/invoices/payments/archive", name: "historie plateb", selector: ".payment-history-table" },
  {
    path: "/reports", name: "účetní tabulka DPH", selector: ".report-accounting-table",
    open: async (page) => { await page.getByRole("tab", { name: "DPH" }).click(); },
  },
];

test.describe("tabulky na úzkém displeji", () => {
  for (const table of TABLES) {
    test(`${table.name} se nečte přes vodorovný posuv`, async ({ page }, testInfo) => {
      // Tablet je součástí měření: 768 px je hranice, na které se pravidla
      // pro karty zapínají, a chyba na hraně je ten pravděpodobnější případ.
      test.skip(!/^(mobile|tablet)/.test(testInfo.project.name), "Měří se jen na úzkých šířkách");
      await page.goto(table.path);
      if (await requireWorkspaceSession(page, table.name)) return;
      await table.open?.(page);
      await page.waitForLoadState("networkidle");

      const wrapper = page.locator(table.selector).first();
      if (await wrapper.count() === 0) {
        test.skip(true, `${table.name}: na této stránce teď nejsou data`);
      }

      const measured = await wrapper.evaluate((element) => {
        const inner = element.querySelector("table") as HTMLElement | null;
        // V kartovém režimu má obal overflow: visible, takže scrollWidth
        // větší než clientWidth NEZNAMENÁ posuvník -- obsah jen přesahuje
        // rámeček a stránka se stejně neposouvá (hlídá smoke.spec.ts).
        // Za selhání se proto bere jen obal, který je SKUTEČNĚ posouvatelný.
        const overflowX = getComputedStyle(element).overflowX;
        const scrollable = overflowX === "auto" || overflowX === "scroll";
        return {
          wrapperScrolls: scrollable && element.scrollWidth > element.clientWidth + 1,
          tableWider: scrollable && inner ? inner.scrollWidth > element.clientWidth + 1 : false,
          headHidden: inner ? getComputedStyle(inner.querySelector("thead") as HTMLElement).display === "none" : false,
          labelled: inner ? Boolean(inner.querySelector("td[data-label]")) : false,
        };
      });

      expect(measured.wrapperScrolls, `${table.name} se posouvá do stran`).toBe(false);
      expect(measured.tableWider, `${table.name} je širší než jeho obal`).toBe(false);
      // Když se hlavička skryje, musí popisky nést buňky -- jinak by
      // z čísel nebylo poznat, co znamenají.
      if (measured.headHidden) {
        expect(measured.labelled, `${table.name}: skrytá hlavička bez data-label`).toBe(true);
      }
    });
  }
});
