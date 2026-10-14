import { expect, test } from "@playwright/test";

test.use({ contextOptions: { reducedMotion: "no-preference" } });

for (const route of ["/", "/en"]) {
  for (const width of [390, 768, 1024, 1440, 1920]) {
    test(`${route}: process reveals on scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 600 });
      await page.goto(route);
      await expect(page.locator("html")).toHaveAttribute("data-motion", "");
      const process = page.locator("#jak-to-funguje");
      const parts = process.locator('[data-reveal="process"]');
      const copies = process.locator('[class*="stepCopy"]');
      await expect(parts).toHaveCount(8);
      await expect(process.locator("[data-shown]")).toHaveCount(0);
      const initialHeight = await process.evaluate((element) => element.getBoundingClientRect().height);
      await expect.poll(() => copies.first().evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
      await copies.first().evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
      await expect(copies.first()).toHaveAttribute("data-shown", "");
      await expect.poll(() => copies.first().evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
      if (width <= 1080) {
        await expect(copies.nth(1)).not.toHaveAttribute("data-shown", "");
        await expect(copies.nth(2)).not.toHaveAttribute("data-shown", "");
      } else {
        const delays = await copies.evaluateAll((elements) => elements.map((element) => parseFloat(getComputedStyle(element).transitionDelay)));
        expect(delays[0]).toBeLessThan(delays[1]);
        expect(delays[1]).toBeLessThan(delays[2]);
      }
      for (const part of await parts.all()) {
        await part.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
        await expect(part).toHaveAttribute("data-shown", "");
        await expect.poll(() => part.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
      }
      expect(await process.evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(initialHeight, 1);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(process.locator('[data-reveal="process"][data-shown]')).toHaveCount(8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    });
  }

  test(`${route}: changing motion preference immediately reveals the process`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("html")).toHaveAttribute("data-motion", "");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("html")).not.toHaveAttribute("data-motion", "");
    const parts = page.locator('#jak-to-funguje [data-reveal="process"]');
    expect(await parts.evaluateAll((elements) => elements.every((element) => getComputedStyle(element).opacity === "1" && getComputedStyle(element).transitionDuration === "0s"))).toBe(true);
  });

  test(`${route}: process stays readable without JavaScript`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, reducedMotion: "no-preference", viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:3000${route}`);
      const parts = page.locator('#jak-to-funguje [data-reveal="process"]');
      await expect(parts).toHaveCount(8);
      expect(await parts.evaluateAll((elements) => elements.every((element) => getComputedStyle(element).opacity === "1"))).toBe(true);
    } finally {
      await context.close();
    }
  });
}
