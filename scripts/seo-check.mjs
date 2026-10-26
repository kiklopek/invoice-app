import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

// Read-only checks against a production build; no authenticated session needed.
const base = process.env.SEO_CHECK_BASE_URL || "http://127.0.0.1:3100";
const origin = new URL(process.env.APP_BASE_URL || "https://www.splatno.com").origin;
const output = ".artifacts/seo";
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  for (const [path, locale] of [["/", "cs"], ["/en", "en"]]) {
    // Read the unrendered response too: metadata and content must not need JS.
    const response = await context.request.get(new URL(path, base).href);
    assert.equal(response.status(), 200, path);
    assert.ok(!response.headers()["x-robots-tag"]?.includes("noindex"), path);
    const html = await response.text();
    assert.ok(html.includes('name="robots" content="index, follow'), path);
    assert.ok(html.includes('application/ld+json'), path);
    assert.ok(html.includes('id="caste-otazky"'), path);

    for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]]) {
      const page = await context.newPage();
      await page.setViewportSize(viewport);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(new URL(path, base).href, { waitUntil: "networkidle" });
      assert.equal(await page.locator('link[rel="icon"][type="image/png"]').getAttribute("href"), "/icon.png");
      assert.equal(await page.locator('link[rel="icon"][type="image/png"]').getAttribute("sizes"), "96x96");
      assert.equal(await page.locator('link[rel="apple-touch-icon"]').getAttribute("href"), "/apple-icon.png");
      assert.equal(await page.locator("h1").count(), 1, path);
      assert.equal(new URL(await page.locator('link[rel="canonical"]').getAttribute("href")).href, `${origin}${path}`);
      assert.equal(await page.locator('meta[property="og:locale"]').getAttribute("content"), locale === "cs" ? "cs_CZ" : "en_GB");
      assert.equal(await page.locator('meta[name="twitter:card"]').getAttribute("content"), "summary_large_image");
      for (const language of ["cs", "en", "x-default"]) {
        assert.equal(new URL(await page.locator(`link[rel="alternate"][hreflang="${language}"]`).getAttribute("href")).href, `${origin}${language === "en" ? "/en" : "/"}`);
      }
      const graph = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
      assert.equal(graph["@graph"][1].inLanguage, locale);
      assert.equal(await page.locator("main").evaluate((node) => node.closest("[lang]").lang), locale);
      assert.equal(await page.locator("#caste-otazky details").count(), 5);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${locale} ${name}: horizontal overflow`);
      await page.screenshot({ path: `${output}/${locale}-${name}.png` });
      const first = page.locator("#caste-otazky details").first();
      await first.locator("summary").click();
      assert.ok(await first.evaluate((node) => node.open));
      await page.screenshot({ path: `${output}/${locale}-${name}-faq.png` });
      assert.deepEqual(errors, [], `${locale} ${name}: browser errors`);
      await page.close();
    }
    const image = await context.request.get(new URL(`/og/${locale}`, base).href);
    assert.equal(image.status(), 200);
    assert.ok(image.headers()["content-type"].startsWith("image/png"));
    const png = await image.body();
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    await writeFile(`${output}/${locale}-share.png`, png);
  }
  const robots = await context.request.get(new URL("/robots.txt", base).href);
  assert.equal(robots.status(), 200);
  assert.ok((await robots.text()).includes(`Sitemap: ${origin}/sitemap.xml`));
  assert.ok(!(await robots.text()).includes("Disallow: /\n"));
  const sitemap = await context.request.get(new URL("/sitemap.xml", base).href);
  assert.equal(sitemap.status(), 200);
  const xml = await sitemap.text();
  assert.deepEqual([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]), [`${origin}/`, `${origin}/en`]);
  for (const path of ["/login", "/register", "/podminky", "/ochrana-osobnich-udaju", "/api/health", "/dashboard", "/invoices/unknown", "/unknown"]) {
    const response = await context.request.get(new URL(path, base).href, { maxRedirects: 0 });
    assert.ok(response.headers()["x-robots-tag"]?.includes("noindex"), path);
  }
  console.log("SEO PASS: server HTML, indexation, canonical URLs, languages, structured data, sitemap, robots, share images and desktop/mobile FAQ.");
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
