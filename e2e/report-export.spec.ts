import { expect, test } from "@playwright/test";

// Export finančního reportu: typ reportu přenastaví obsah, náhled se po změně
// sestaví sám a PDF se posouvá uvnitř dialogu (nepřetéká přes patičku).
for (const [width, height] of [[1470, 830], [1920, 1080]]) {
  test(`report export preview stays inside the dialog and scrolls at ${width}px`, async ({ page }) => {
    const pdfRequests: string[] = [];
    const cspErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy/i.test(m.text())) cspErrors.push(m.text()); });
    page.on("request", (r) => { if (r.url().endsWith("/api/reports/pdf")) pdfRequests.push(r.postData() ?? ""); });
    await page.setViewportSize({ width, height });
    await page.goto("/reports");
    await page.getByRole("button", { name: "Exportovat report" }).click();
    const dialog = page.getByRole("dialog");
    const download = dialog.getByRole("button", { name: "Stáhnout PDF" });
    await expect(download).toBeEnabled({ timeout: 60_000 });
    // Wait until the PDF pages are drawn (the page counter appears).
    await expect(dialog.getByText(/Strana 1 \/ \d+/)).toBeVisible({ timeout: 60_000 });

    const layout = async () => dialog.evaluate((node) => {
      const preview = node.querySelector<HTMLElement>('[aria-label="Náhled finančního reportu"]')!;
      const footer = node.querySelector<HTMLElement>("footer")!;
      // The scrolling element of the PDF preview: the deepest overflowing box.
      const scroller = [...preview.querySelectorAll<HTMLElement>("*")].find((el) => {
        const cs = getComputedStyle(el);
        return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
      });
      return {
        previewBottom: preview.getBoundingClientRect().bottom,
        footerTop: footer.getBoundingClientRect().top,
        scrollerBottom: scroller?.getBoundingClientRect().bottom ?? Infinity,
        scrollable: Boolean(scroller),
      };
    });
    let box = await layout();
    expect(box.scrollable).toBe(true);
    expect(box.previewBottom).toBeLessThanOrEqual(box.footerTop + 1);
    expect(box.scrollerBottom).toBeLessThanOrEqual(box.footerTop + 1);

    // The wheel over the preview scrolls the PDF.
    const preview = dialog.getByLabel("Náhled finančního reportu");
    const before = await preview.evaluate((p) => [...p.querySelectorAll<HTMLElement>("*")].map((e) => e.scrollTop).reduce((a, b) => a + b, 0));
    await preview.hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => preview.evaluate((p) => [...p.querySelectorAll<HTMLElement>("*")].map((e) => e.scrollTop).reduce((a, b) => a + b, 0))).toBeGreaterThan(before);

    // Changing the type presets the options and rebuilds the preview by itself.
    await dialog.getByLabel(/Souhrnný report/).check();
    await expect(dialog.getByLabel("Zahrnout detailní tabulky")).not.toBeChecked();
    await expect(download).toBeEnabled({ timeout: 60_000 });
    expect(JSON.parse(pdfRequests.at(-1)!).options).toMatchObject({ mode: "summary" });
    box = await layout();
    expect(box.previewBottom).toBeLessThanOrEqual(box.footerTop + 1);

    // The hidden print frame loads the same PDF (CSP frame-src allows blob:).
    await expect(page.locator('iframe[title="PDF připravené pro tisk"]')).toHaveAttribute("src", /^blob:/);
    await expect.poll(() => cspErrors).toEqual([]);
  });
}
