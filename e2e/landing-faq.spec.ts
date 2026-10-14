import { expect, test, type Locator, type Page } from "@playwright/test";
import { getDictionary } from "../src/i18n/dictionaries";

test.use({ storageState: { cookies: [], origins: [] } });

const WIDTHS = [320, 360, 390, 640, 768, 980, 981, 1024, 1440, 1920, 2560];

async function checkLayout(page: Page, faq: Locator) {
  const problems = await faq.evaluate((section) => {
    const issues: string[] = [];
    const viewport = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > viewport + 1) issues.push("page overflow");
    const visible = [...section.querySelectorAll<HTMLElement>("h2, summary, summary span, summary svg, details[open] p")];
    for (const element of visible) {
      const rect = element.getBoundingClientRect();
      if (rect.left < -1 || rect.right > viewport + 1) issues.push(`${element.tagName}: outside viewport`);
      if (element.scrollWidth > element.clientWidth + 1 && element.tagName !== "svg") issues.push(`${element.tagName}: clipped text`);
    }
    for (const summary of section.querySelectorAll("summary")) {
      const [question, icon] = summary.children;
      if (question.getBoundingClientRect().right > icon.getBoundingClientRect().left) issues.push("question overlaps icon");
      if (summary.getBoundingClientRect().height < 44) issues.push("small touch target");
    }
    return issues;
  });
  expect(problems).toEqual([]);
}

for (const locale of ["cs", "en"] as const) {
  const route = locale === "cs" ? "/" : "/en";
  const content = getDictionary(locale).landing.faq;

  for (const width of WIDTHS) {
    test(`${locale}: FAQ fits ${width}px closed, with one and with all answers open`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      const faq = page.locator("#caste-otazky");
      const cards = faq.locator("details");
      const summaries = faq.locator("summary");
      await expect(faq.getByRole("heading", { level: 2 })).toHaveText(content.title);
      await expect(summaries.locator("[data-faq-question]")).toHaveText(content.items.map((item) => item.question));
      await expect(cards.locator("p")).toHaveText(content.items.map((item) => item.answer));
      await expect(faq.locator("details[open]")).toHaveCount(0);
      expect(await faq.getAttribute("aria-labelledby")).toBe("faq-title");
      await checkLayout(page, faq);

      const layout = await faq.evaluate((section) => {
        const heading = section.querySelector("h2")!.getBoundingClientRect();
        const list = section.querySelector("details")!.getBoundingClientRect();
        return { headingRight: heading.right, headingBottom: heading.bottom, listLeft: list.left, listTop: list.top };
      });
      if (width > 980) expect(layout.listLeft).toBeGreaterThan(layout.headingRight);
      else expect(layout.listTop).toBeGreaterThan(layout.headingBottom);

      if ([390, 768, 1440].includes(width)) {
        await testInfo.attach("FAQ closed", { body: await faq.screenshot({ animations: "disabled", style: "header { visibility: hidden !important; }" }), contentType: "image/png" });
      }
      await summaries.first().click();
      await expect(faq.locator("details[open]")).toHaveCount(1);
      await checkLayout(page, faq);
      for (let index = 1; index < content.items.length; index++) await summaries.nth(index).click();
      await expect(faq.locator("details[open]")).toHaveCount(content.items.length);
      await checkLayout(page, faq);
      if ([390, 768, 1440].includes(width)) {
        await testInfo.attach("FAQ expanded", { body: await faq.screenshot({ animations: "disabled", style: "header { visibility: hidden !important; }" }), contentType: "image/png" });
      }
    });
  }

  test(`${locale}: native keyboard controls and reduced motion`, async ({ page }) => {
    await page.goto(route);
    const faq = page.locator("#caste-otazky");
    const first = faq.locator("summary").first();
    await first.focus();
    await expect(first).toBeFocused();
    expect(await first.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
    await page.keyboard.press("Enter");
    await expect(faq.locator("details[open]")).toHaveCount(1);
    await page.keyboard.press("Space");
    await expect(faq.locator("details[open]")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(faq.locator("summary").nth(1)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(first).toBeFocused();
    await first.click();
    expect(await first.locator("svg").getAttribute("aria-hidden")).toBe("true");
    expect(await first.locator("svg").evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
  });

  test(`${locale}: answers work without JavaScript`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:3000${route}`);
      const faq = page.locator("#caste-otazky");
      await faq.locator("summary").first().click();
      await expect(faq.locator("details[open] p")).toHaveText(content.items[0].answer);
      await faq.locator("summary").nth(1).click();
      await expect(faq.locator("details[open]")).toHaveCount(2);
      await faq.locator("summary").first().click();
      await expect(faq.locator("details[open]")).toHaveCount(1);
      await checkLayout(page, faq);
    } finally {
      await context.close();
    }
  });

  test(`${locale}: readable at 200% zoom`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(route);
    // CSS zoom exercises actual layout and text scaling, unlike deviceScaleFactor.
    await page.locator("html").evaluate((element) => { element.style.zoom = "2"; });
    const faq = page.locator("#caste-otazky");
    await faq.locator("summary").first().click();
    await expect(faq.locator("details[open] p")).toBeVisible();
    await checkLayout(page, faq);
  });
}
