import { describe, it } from "vitest";
import { parseInvoiceText } from "./invoice-ocr";

const organization = { name: "R. Hlavica s.r.o.", ico: "26296039", dic: "CZ26296039" };

const multiRate = `
R. HLAVICA s.r.o.
IČ : 26296039

Daňový doklad FAKTURA
Číslo faktury : 2600300
Odběratel : Velký Zákazník a.s.
IČO : 87654321

Datum vystavení : 10.09.2026
Datum splatnosti: 24.09.2026

Sazba DPH : Není předmětem Osvobozeno (0% ) Snížená Základní (21%) Celkem
Daň : DPH 0,00 0,01 165 000 000 000,00 165 000 000 000,00
Základ daně : 0,00 0,01 785 714 285 714,29 785 714 285 714,29
Celkem : 0,00 0,01 950 714 285 714,29 950 714 285 714,29

K úhradě : 950 714 285 714,29 Kč
`;

describe("diag rate", () => {
  it("multi-rate line with tiny candidate against a very large gross", () => {
    const result = parseInvoiceText({ text: multiRate, fileUrl: "x", organization });
    console.log(JSON.stringify(result.invoice, null, 2));
    console.log("WARNINGS:", JSON.stringify(result.warnings, null, 2));
  });
});
