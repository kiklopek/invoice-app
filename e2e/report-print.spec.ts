import { expect, test } from "@playwright/test";

test("printed report keeps the status chart and table borders visible", async ({ page }) => {
  await page.goto("/reports");
  test.skip(page.url().includes("/login"), "Requires a demo or authenticated test session");

  await expect(page.locator(".donut")).toBeVisible();
  await page.emulateMedia({ media: "print" });

  const printChart = page.locator(".donut-print-chart");
  await expect(printChart).toBeVisible();
  expect(await printChart.locator("circle").count()).toBeGreaterThan(1);

  const firstHeader = page.locator(".debtor-table thead tr:not(.report-print-table-spacer) th").first();
  const printStyles = await firstHeader.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderWidth: style.borderTopWidth, color: style.color };
  });
  expect(Number.parseFloat(printStyles.borderWidth)).toBeGreaterThan(0);
  expect(printStyles.color).not.toBe("rgba(0, 0, 0, 0)");
});
