import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

// Kolečko myši musí posouvat dokument, ne vnitřní kontejner. Globální
// `overflow-x: hidden` z body dělal druhý svislý scroll kontejner; Chrome do
// něj odkláněl část gesta a stránka se při posouvání „zasekávala“.
for (const route of ["/", "/en"]) {
  for (const width of [1440, 1920]) {
    test(`${route} scrolls the document with the wheel at ${width}px`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "wheel routing differs per engine; the bug was Chromium");
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route, { waitUntil: "networkidle" });
      await page.mouse.move(width / 2, 450);
      for (let step = 0; step < 9; step++) {
        await page.mouse.wheel(0, 100);
        await page.waitForTimeout(40);
      }
      await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(900);
      expect(await page.evaluate(() => document.body.scrollTop)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

      await page.mouse.wheel(0, -450);
      await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(450);
      expect(await page.evaluate(() => document.body.scrollTop)).toBe(0);
    });
  }
}
