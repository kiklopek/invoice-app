import { describe, expect, it, vi } from "vitest";
import { getDocumentProxy, extractText } from "unpdf";
import { PDFDocument, PrintScaling } from "pdf-lib";

vi.mock("server-only", () => ({}));

import {
  generateInvoicePdf,
  invoicePdfFilename,
  type InvoicePdfCompany,
} from "./invoice-pdf";
import type { Invoice } from "@/types/invoice";

const fixtureInvoice: Invoice = {
  id: "11111111-1111-1111-1111-111111111111",
  organization_id: "22222222-2222-2222-2222-222222222222",
  reminder_policy_id: null,
  reminder_days_snapshot: [-3, 0, 7, 14],
  reminder_plan_effective_from: null,
  reminder_policy: null,
  invoice_number: "2026-0042",
  counterparty_name: "Novák Property Invest s.r.o.",
  counterparty_ico: "12345678",
  counterparty_dic: "CZ12345678",
  counterparty_email: "odber@example.com",
  variable_symbol: "20260042",
  amount_without_vat: 10000,
  vat_rate: 21,
  amount: 12100,
  paid_amount: 2000,
  currency: "CZK",
  issue_date: "2026-01-05",
  due_date: "2026-01-19",
  status: "pending",
  source: "manual",
  file_url: null,
  notes: "Děkujeme za spolupráci.",
  paid_at: null,
  reminders_sent: 0,
  last_reminder_at: null,
  next_reminder_at: null,
  reminders_paused: false,
  reminders_paused_at: null,
  reminders_paused_by: null,
  created_at: "2026-01-05T00:00:00.000Z",
  updated_at: "2026-01-05T00:00:00.000Z",
};

const fixtureCompany: InvoicePdfCompany = {
  name: "Hlavica Drevo s.r.o.",
  ico: "87654321",
  dic: "CZ87654321",
  registered_address: "Hlavní 1, 110 00 Praha",
  operating_address: null,
  phone: "+420123456789",
  email: "info@hlavicadrevo.cz",
  bank_account_czk: "123456789/0800",
  bank_account_eur: null,
};

describe("generateInvoicePdf", () => {
  it("returns non-empty bytes starting with the PDF magic header", async () => {
    const bytes = await generateInvoicePdf(fixtureInvoice, fixtureCompany);
    expect(bytes.length).toBeGreaterThan(0);
    const header = Buffer.from(bytes.slice(0, 5)).toString("ascii");
    expect(header).toBe("%PDF-");
  });

  it("includes the invoice number, counterparty, and a formatted amount in the extracted text", async () => {
    const bytes = await generateInvoicePdf(fixtureInvoice, fixtureCompany);
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const normalized = text.replace(/ /g, " ");
    expect(normalized).toContain(fixtureInvoice.invoice_number);
    expect(normalized).toContain(fixtureInvoice.counterparty_name);
    expect(normalized).toContain("12 100,00 CZK");
  });
});

// Neplátce DPH nesmí na faktuře uvádět DPH; dřív PDF tiskl „Sazba DPH“
// a „DPH“ každé firmě.
describe("plátce a neplátce DPH", () => {
  const textOf = async (
    company: InvoicePdfCompany,
    invoice = fixtureInvoice,
  ) => {
    const pdf = await getDocumentProxy(
      await generateInvoicePdf(invoice, company),
    );
    return (await extractText(pdf, { mergePages: true })).text.replace(
      / /g,
      " ",
    );
  };

  it("prints VAT lines for a VAT payer", async () => {
    const text = await textOf({ ...fixtureCompany, vat_payer: true });
    expect(text).toContain("Sazba DPH");
    expect(text).not.toContain("Nejsem plátce DPH");
  });

  it("prints no VAT lines and states it for a non-payer", async () => {
    const text = await textOf(
      { ...fixtureCompany, vat_payer: false },
      { ...fixtureInvoice, vat_rate: 0, amount_without_vat: 12100 },
    );
    expect(text).toContain("Nejsem plátce DPH");
    expect(text).not.toContain("Sazba DPH");
    expect(text).toContain("12 100,00 CZK");
  });
});

describe("Czech text in the generated PDF", () => {
  // Standardni fonty pdf-lib umi jen WinAnsi, kde chybi pismena s hackem
  // a krouzkem. Generator je proto transliteroval: na fakture, kterou
  // zakaznik posila svemu odberateli, stalo "Dvorak" misto "Dvořák"
  // a "Kc" misto "Kč". Pro ceskou fakturacni aplikaci je to diskvalifikujici.
  const czechInvoice: Invoice = {
    ...fixtureInvoice,
    counterparty_name: "Dvořák & Plzeň Příbram s.r.o.",
    notes: "Děkujeme za spolupráci. Žádáme úhradu do data splatnosti.",
  };
  const czechCompany: InvoicePdfCompany = {
    ...fixtureCompany,
    name: "Hlavička Dřevo s.r.o.",
    registered_address: "Náměstí Svobody 12, Říčany u Prahy",
  };

  it("keeps every Czech letter instead of transliterating it", async () => {
    const bytes = await generateInvoicePdf(czechInvoice, czechCompany);
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const normalized = text.replace(/ /g, " ");
    for (const word of [
      "Dvořák",
      "Plzeň",
      "Příbram",
      "Hlavička",
      "Dřevo",
      "Říčany",
      "Děkujeme",
      "spolupráci",
    ]) {
      expect(normalized, `chybí "${word}"`).toContain(word);
    }
    // Pevne popisky samotneho formulare faktury musi byt cesky taky --
    // prave tyhle znaky (Č, č, ě) standardni WinAnsi font neumi.
    // Pozn.: menu aplikace formatuje jako ISO kod ("12 100,00 CZK"),
    // takze symbol "Kč" se v dokumentu nevyskytuje vubec.
    for (const label of [
      "IČO",
      "Vyúčtování",
      "Odběratel",
      "Částka bez DPH",
      "Zbývá uhradit",
    ]) {
      expect(normalized, `chybí popisek "${label}"`).toContain(label);
    }
  });

  it("never falls back to the transliterated spelling", async () => {
    const bytes = await generateInvoicePdf(czechInvoice, czechCompany);
    const { text } = await extractText(await getDocumentProxy(bytes), {
      mergePages: true,
    });
    for (const wrong of [
      "Dvorak",
      "Plzen",
      "Hlavicka",
      "Drevo",
      "Ricany",
      "Dekujeme",
    ]) {
      expect(text, `transliterováno na "${wrong}"`).not.toContain(wrong);
    }
  });

  it("stays small enough to attach to every reminder e-mail", async () => {
    // Font se musi vkladat jako podmnozina znaku; cely Liberation Sans ma
    // stovky kB a pripojoval by se ke kazdemu odeslanemu e-mailu.
    const bytes = await generateInvoicePdf(czechInvoice, czechCompany);
    expect(bytes.length).toBeLessThan(300_000);
  });
});

describe("QR platba", () => {
  // Pozor: ucet ve fixtureCompany (123456789/0800) neprojde ceskou mod-11
  // kontrolou, takze u nej se QR VEDOME nekresli. Testy nize proto pouzivaji
  // skutecny ucet organizace z databaze.
  const payableCompany: InvoicePdfCompany = {
    ...fixtureCompany,
    bank_account_czk: "6786420257/0100",
  };
  const hasEmbeddedImage = (bytes: Uint8Array) =>
    Buffer.from(bytes).toString("latin1").includes("/Subtype /Image");

  it("embeds a QR code when the account can actually be paid to", async () => {
    const bytes = await generateInvoicePdf(fixtureInvoice, payableCompany);
    expect(hasEmbeddedImage(bytes)).toBe(true);
    const { text } = await extractText(await getDocumentProxy(bytes), {
      mergePages: true,
    });
    expect(text).toContain("QR platba");
  });

  it("draws no QR code at all when the account fails the checksum", async () => {
    // Vymysleny nebo poskozeny QR kod je horsi nez zadny: vypada funkcne
    // a poslal by penize jinam.
    const bytes = await generateInvoicePdf(fixtureInvoice, fixtureCompany);
    expect(hasEmbeddedImage(bytes)).toBe(false);
    const { text } = await extractText(await getDocumentProxy(bytes), {
      mergePages: true,
    });
    expect(text).not.toContain("QR platba");
  });

  it("asks for the amount that is still outstanding, not the full invoice", async () => {
    // Faktura je castecne uhrazena (12 100 - 2 000), takze QR ma znit na 10 100.
    const spaydAmount = (await import("./czech-payment")).buildSpayd({
      account: payableCompany.bank_account_czk,
      amount:
        Number(fixtureInvoice.amount) - Number(fixtureInvoice.paid_amount),
      currency: fixtureInvoice.currency,
      variableSymbol: fixtureInvoice.variable_symbol,
    });
    expect(spaydAmount).toContain("AM:10100.00");
  });
});

describe("long invoices", () => {
  // Generator kreslil na jednu pevnou A4 bez jakekoli kontroly, jestli se
  // obsah vejde: dlouha poznamka se vykreslila pod spodni okraj a zmizela.
  const longInvoice: Invoice = {
    ...fixtureInvoice,
    notes: Array.from(
      { length: 60 },
      (_, index) =>
        `Řádek poznámky číslo ${index + 1}: dodávka materiálu včetně dopravy a montáže na stavbě.`,
    ).join(" "),
  };

  it("adds pages instead of drawing past the bottom margin", async () => {
    const bytes = await generateInvoicePdf(longInvoice, fixtureCompany);
    const pdf = await getDocumentProxy(bytes);
    expect(pdf.numPages).toBeGreaterThan(1);
  });

  it("keeps the overflowing text readable instead of dropping it", async () => {
    const bytes = await generateInvoicePdf(longInvoice, fixtureCompany);
    const { text } = await extractText(await getDocumentProxy(bytes), {
      mergePages: true,
    });
    // Prvni i posledni radek poznamky musi byt v dokumentu.
    expect(text).toContain("Řádek poznámky číslo 1:");
    expect(text).toContain("Řádek poznámky číslo 60:");
  });
});

describe("invoicePdfFilename", () => {
  it("sanitizes the invoice number to a safe filename", () => {
    expect(
      invoicePdfFilename({ ...fixtureInvoice, invoice_number: "2026/0042 #x" }),
    ).toBe("Faktura-20260042x.pdf");
  });
});

describe("účet uložený na faktuře (z PDF dokladu)", () => {
  // Firma s více korunovými účty: faktura, na jejímž dokladu OCR našlo druhý
  // účet, ho musí mít i v PDF (a v QR), ne první účet v měně.
  const company: InvoicePdfCompany = {
    ...fixtureCompany,
    bank_account_czk: "6786420257/0100",
    bank_accounts: [{ account: "6844160247/0100", currency: "CZK" }],
  };

  it("prints the stored account instead of the main account", async () => {
    const bytes = await generateInvoicePdf(
      { ...fixtureInvoice, payment_account: "6844160247/0100" },
      company,
    );
    const { text } = await extractText(await getDocumentProxy(bytes), {
      mergePages: true,
    });
    expect(text).toContain("6844160247/0100");
    expect(text).not.toContain("6786420257/0100");
  });

  it("prints the main account when the invoice has no stored account", async () => {
    const bytes = await generateInvoicePdf(
      { ...fixtureInvoice, payment_account: null },
      company,
    );
    const { text } = await extractText(await getDocumentProxy(bytes), {
      mergePages: true,
    });
    expect(text).toContain("6786420257/0100");
  });
});

// The same persisted document model feeds the live view and final PDF.
import { creationDocument, creationInput } from "./invoice-creation";
import {
  fixture as issuedFixture,
  supplier as issuedSupplier,
} from "@/test/invoice-creation-fixtures";
describe("issued itemized invoice PDFs", () => {
  it("uses A4 with actual-size print preferences and safe content margins", async () => {
    const snapshot = creationDocument(issuedFixture(), issuedSupplier);
    const bytes = await generateInvoicePdf({ ...fixtureInvoice, ...creationInput(snapshot) }, fixtureCompany);
    const document = await PDFDocument.load(bytes);
    expect(document.catalog.getOrCreateViewerPreferences().getPrintScaling()).toBe(PrintScaling.None);
    for (const page of document.getPages()) {
      expect(page.getSize().width).toBeCloseTo(595.28, 1);
      expect(page.getSize().height).toBeCloseTo(841.89, 1);
    }
    const pdf = await getDocumentProxy(bytes);
    const text = await (await pdf.getPage(1)).getTextContent();
    for (const item of text.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      expect(item.transform[4]).toBeGreaterThanOrEqual(41);
      expect(item.transform[4] + item.width).toBeLessThanOrEqual(554);
      expect(item.transform[5]).toBeGreaterThanOrEqual(20);
      expect(item.transform[5] + item.height).toBeLessThan(805);
    }
  });
  it("keeps all 200 products, repeated headers and the complete payment summary across A4 pages", async () => {
    const draft = issuedFixture();
    draft.items = Array.from({ length: 200 }, (_, i) => ({
      ...draft.items[0],
      id: `product-${i}`,
      description: `PRODUCT_${String(i + 1).padStart(3, "0")} ${"Dodávka výrobku s podrobným popisem. ".repeat(i % 7 === 0 ? 10 : 1)}`,
      vat_rate: i % 2 ? 12 : 21,
    }));
    const snapshot = creationDocument(draft, issuedSupplier);
    const pdf = await getDocumentProxy(
      await generateInvoicePdf(
        { ...fixtureInvoice, ...creationInput(snapshot) },
        fixtureCompany,
      ),
    );
    expect(pdf.numPages).toBeGreaterThan(3);
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n),
        content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ");
      pages.push(text);
      expect(text).toContain(`${n} / ${pdf.numPages}`);
      if (text.includes("PRODUCT_")) {
        expect(text).toContain("Položka");
        expect(text).toContain("Množství");
      }
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        expect(item.transform[4]).toBeGreaterThanOrEqual(40);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(555);
        expect(item.transform[5]).toBeGreaterThanOrEqual(20);
      }
    }
    const text = pages.join(" ");
    for (let n = 1; n <= 200; n++)
      expect(
        text.match(new RegExp(`PRODUCT_${String(n).padStart(3, "0")}`, "g")),
      ).toHaveLength(1);
    expect(text.match(/Celkem k úhradě/g)).toHaveLength(1);
    const final = pages.at(-1)!;
    expect(final).toContain("Celkem k úhradě");
    expect(final).toContain("PLATEBNÍ ÚDAJE");
    expect(final).toContain("QR platba");
  });
  it("uses immutable identities, mixed VAT, DUZP and public notes, excluding internal notes", async () => {
    const draft = issuedFixture();
    draft.tax_date = "2026-10-20";
    draft.public_note = "PUBLIC-NOTE";
    draft.internal_note = "PRIVATE-NOTE-DO-NOT-SEND";
    draft.items.push({
      ...draft.items[0],
      id: "second",
      description: "Druhá služba",
      unit_price: "1000",
      vat_rate: 12,
    });
    const snapshot = creationDocument(draft, issuedSupplier);
    const bytes = await generateInvoicePdf(
      { ...fixtureInvoice, ...creationInput(snapshot) },
      { ...fixtureCompany, name: "CHANGED-COMPANY-NOT-ON-DOCUMENT" },
    );
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    expect(text).toContain(issuedSupplier.name);
    expect(text).not.toContain("CHANGED-COMPANY-NOT-ON-DOCUMENT");
    expect(text).toContain("DUZP: 20. 10. 2026");
    expect(text).toContain("Druhá služba");
    expect(text).toContain("DPH 12 %");
    expect(text).toContain("DPH 21 %");
    expect(text).toContain("PUBLIC-NOTE");
    expect(text).not.toContain("PRIVATE-NOTE");
  });
  it("supports non-payers and paginates long items/notes without losing the tail", async () => {
    const draft = issuedFixture();
    draft.payment_method = "cash";
    draft.public_note =
      Array.from(
        { length: 200 },
        (_, i) => `Řádek ${i}: dlouhá poznámka.`,
      ).join("\n") + "\nLAST-DOCUMENT-LINE";
    draft.items = Array.from({ length: 50 }, (_, i) => ({
      ...draft.items[0],
      id: String(i),
      description: `Položka ${i}: ${"dlouhý název ".repeat(8)}`,
    }));
    const snapshot = creationDocument(draft, {
      ...issuedSupplier,
      vat_payer: false,
      dic: "",
    });
    const pdf = await getDocumentProxy(
      await generateInvoicePdf(
        { ...fixtureInvoice, ...creationInput(snapshot) },
        fixtureCompany,
      ),
    );
    expect(pdf.numPages).toBeGreaterThan(1);
    const { text } = await extractText(pdf, { mergePages: true });
    expect(text).toContain("Dodavatel není plátcem DPH.");
    expect(text).toContain("LAST-DOCUMENT-LINE");
    expect(text).not.toContain("DPH 21 %");
  });
});
