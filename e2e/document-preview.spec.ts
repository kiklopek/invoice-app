import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { requireWorkspaceSession } from "./session";

test("náhled původního PDF a výběr textu zůstávají dostupné při timeoutu OCR", async ({ page }) => {
  await page.goto("/invoices/import");
  if (await requireWorkspaceSession(page, "náhled PDF bez OCR")) return;

  const path = "preview-test/document.pdf";
  // Simulate upload and the OCR timeout without storing a document or invoice.
  await page.route("**/api/invoices/upload", route => route.fulfill({ json: { path, token: "test-token" } }));
  await page.route("**/storage/v1/object/upload/sign/**", route => route.fulfill({ json: { Key: `invoice-documents/${path}` } }));
  await page.route("**/api/invoices/upload/verify", route => route.fulfill({ json: { verified: true } }));
  await page.route("**/api/invoices/extract", route => route.fulfill({ status: 504, json: { error: "Test OCR timeout" } }));

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([600, 800]).drawText("Original PDF text", { x: 60, y: 650, size: 24, font });
  await page.getByLabel("Vybrat dokumenty faktur").setInputFiles({ name: "preview.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "Nahrát a načíst údaje", exact: true }).click();

  await expect(page.locator("#manual-invoice-form")).toBeVisible();
  await expect(page.getByText("Automatické načtení se nezdařilo", { exact: true })).toBeVisible();
  const documentTab = page.getByRole("tab", { name: "Doklad", exact: true });
  if (await documentTab.isVisible()) await documentTab.click();

  await expect(page.locator(".document-preview")).toBeVisible();
  const text = page.locator(".document-preview-text-layer span").filter({ hasText: "Original PDF text" });
  await expect(text).toBeVisible();
  await text.click({ clickCount: 3 });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toContain("Original PDF text");
});
