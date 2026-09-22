import { expect, test } from "@playwright/test";
import { requireWorkspaceSession } from "./session";

// V CSS je osmnáct různých šířek v @media dotazech. Plán je sjednotit je na
// čtyři, ale přemapovat je naslepo znamená změnit vykreslení na šířkách,
// které žádný snímek nehlídá. Tenhle spec proto hlídá CHOVÁNÍ na každé
// existující hranici -- ne vzhled, ale to, co se na ní rozbít může:
//
//   1. dvě navigace naráz (historicky pásmo 761-780 px, kde byl vidět
//      hamburger a zároveň platil desktopový margin-left),
//   2. vodorovné přetékání stránky,
//   3. obsah schovaný pod postranním panelem.
//
// Díky tomu je sjednocení breakpointů ověřitelná změna, ne sázka.

// Každá hodnota z @media v repu, plus o pixel vedle, protože chyby vznikají
// právě na hraně.
const BOUNDARIES = [360, 380, 400, 420, 480, 520, 560, 640, 760, 768, 780, 820, 900, 980, 1024, 1100, 1180, 1280];
const WIDTHS = [...new Set(BOUNDARIES.flatMap((width) => [width - 1, width]))].sort((a, b) => a - b);

const PAGES = ["/dashboard", "/invoices", "/reports"];

test.describe("chování na hranicích breakpointů", () => {
  for (const path of PAGES) {
    test(`${path} se drží pohromadě na každé hranici`, async ({ page }, testInfo) => {
      // Šířky se nastavují ručně, takže stačí jeden prohlížeč.
      test.skip(testInfo.project.name !== "desktop", "Stačí jeden prohlížeč");
      await page.goto(path);
      if (await requireWorkspaceSession(page, `breakpointy ${path}`)) return;
      await page.waitForLoadState("networkidle");

      const problems: string[] = [];
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        const state = await page.evaluate(() => {
          const visible = (selector: string) => {
            const element = document.querySelector(selector) as HTMLElement | null;
            return Boolean(element) && getComputedStyle(element!).display !== "none";
          };
          const content = document.querySelector(".content") as HTMLElement | null;
          return {
            hamburger: visible(".mobile-navigation-shell"),
            desktopNav: visible(".sidebar .desktop-navigation"),
            contentMargin: content ? Number.parseInt(getComputedStyle(content).marginLeft, 10) || 0 : 0,
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
          };
        });

        if (state.hamburger && state.desktopNav) problems.push(`${width}px: obě navigace najednou`);
        // Mobilní navigace a desktopové odsazení se navzájem vylučují --
        // jinak obsah uhne pryč od panelu, který tam není.
        if (state.hamburger && state.contentMargin > 0) problems.push(`${width}px: hamburger, ale obsah odsazený o ${state.contentMargin}px`);
        if (!state.hamburger && state.desktopNav && state.contentMargin === 0) problems.push(`${width}px: postranní panel bez odsazení obsahu`);
        if (state.scroll > state.client + 1) problems.push(`${width}px: přetéká do stran (${state.scroll} > ${state.client})`);
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
});
