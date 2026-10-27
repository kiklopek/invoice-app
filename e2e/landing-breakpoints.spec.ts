import { expect, test, type Page } from "@playwright/test";

const WIDTHS = [320, 330, 359, 360, 380, 390, 440, 639, 640, 641, 667, 760, 761, 768, 820, 834, 979, 980, 981, 1024, 1079, 1080, 1081, 1180, 1279, 1280, 1366, 1439, 1440, 1599, 1600, 1759, 1760, 1919, 1920, 2560, 3840];

async function resize(page: Page, width: number) {
  await page.bringToFront();
  await page.setViewportSize({ width, height: 1000 });
  // Locator assertions retry across dev-server reloads; raw page.evaluate
  // can run while the document is being replaced and lose its context.
  await expect(page.locator("html")).toHaveJSProperty("offsetWidth", width);
}

async function layoutProblems(page: Page) {
  return page.evaluate(() => {
    const issues: string[] = [];
    const viewport = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > viewport + 1) issues.push("page overflow");
    // overflow-x:clip on the page can conceal inner clipping, so inspect text too.
    const selector = 'header a, header button, main h1, main h2, [class*="stepCopy"] h3, [class*="stepCopy"] p, [class*="heroCopy"] > p, [class*="heroCtas"] a, [class*="heroCtas"] button, [class*="trust"] li, [class*="personaCopy"] h3, [class*="personaCopy"] p, #cenik a, #cenik button, #caste-otazky summary, #caste-otazky details[open] p, footer a, [class*="dashStats"] small, [class*="dashStats"] strong, [class*="dashStats"] em';
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!rect.width || !rect.height || style.visibility === "hidden") continue;
      const label = element.textContent?.trim().slice(0, 50);
      if (rect.left < -1 || rect.right > viewport + 1) issues.push(`${label}: outside viewport`);
      if (label && element.scrollWidth > element.clientWidth + 1) issues.push(`${label}: clipped`);
      if (element.matches("h1,h2,h3,p")) {
        const range = document.createRange();
        range.selectNodeContents(element);
        if ([...range.getClientRects()].some((textRect) => textRect.width > 1 && (textRect.left < rect.left - 1 || textRect.right > rect.right + 1))) issues.push(`${label}: text outside its box`);
      }
    }
    const buttons = [...document.querySelectorAll<HTMLElement>('[class*="heroCtas"] a, [class*="heroCtas"] button')].map((element) => element.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
    for (let index = 1; index < buttons.length; index++) {
      const a = buttons[index - 1], b = buttons[index];
      if (Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1) issues.push("hero actions overlap");
    }
    return issues;
  });
}

for (const route of ["/", "/en"]) {
  test(`${route}: resizing across mobile, tablet and desktop preserves content`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.bringToFront();
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const problems: string[] = [];
    // Resize both ways without a reload: open answers and billing state must survive.
    for (const [expanded, widths] of [[false, WIDTHS], [true, [...WIDTHS].reverse()]] as const) {
      if (expanded) {
        for (const summary of await page.locator("#caste-otazky summary").all()) await summary.click();
        await page.getByRole("switch").click();
      }
      for (const width of widths) {
        await resize(page, width);
        problems.push(...(await layoutProblems(page)).map((issue) => `${width}px, ${expanded ? "expanded/yearly" : "closed/monthly"}: ${issue}`));
        await expect(page.locator("#caste-otazky details[open]")).toHaveCount(expanded ? 5 : 0);
        const periodControl = width <= 640 ? page.getByRole("radio").last() : page.getByRole("switch");
        await expect(periodControl).toHaveAttribute("aria-checked", String(expanded));
        if (!expanded && [390, 768, 1024, 1440, 1920].includes(width)) {
          await testInfo.attach(`hero-${width}`, { body: await page.locator('[class*="heroGrid"]').screenshot({ animations: "disabled" }), contentType: "image/png" });
          await testInfo.attach(`process-${width}`, { body: await page.locator("#jak-to-funguje").screenshot({ animations: "disabled", style: "header { visibility: hidden !important; }" }), contentType: "image/png" });
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test(`${route}: desktop typography and spacing do not jump at adjacent widths`, async ({ page }) => {
    await page.bringToFront();
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [1080, 1439, 1599, 1759, 1919]) {
      const metrics: number[][] = [];
      for (const nextWidth of [width, width + 1]) {
        await resize(page, nextWidth);
        metrics.push(await page.evaluate(() => {
          const heading = document.querySelector("h1")!;
          const range = document.createRange();
          range.selectNodeContents(heading);
          const textLine = [...range.getClientRects()].find((rect) => rect.height > 1)!;
          const container = document.querySelector("header > div")!;
          const scale = Number.parseFloat(getComputedStyle(document.querySelector('[class*="page"]')!).zoom) || 1;
          return [textLine.height, Number.parseFloat(getComputedStyle(container).paddingLeft) * scale];
        }));
      }
      expect(Math.abs(metrics[1][0] - metrics[0][0]), `${width}px: visible heading size jumps`).toBeLessThan(1);
      expect(Math.abs(metrics[1][1] - metrics[0][1]), `${width}px: page gutter jumps`).toBeLessThan(1);
    }
  });
}
