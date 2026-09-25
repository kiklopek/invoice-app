import { describe, it } from "vitest";
import { parseInvoiceText } from "./invoice-ocr";

const organization = { name: "R. Hlavica s.r.o.", ico: "26296039", dic: "CZ26296039" };

const foInvoice = `
R. HLAVICA s.r.o.
IČ : 26296039
DIČ : CZ26296039
IBAN : CZ3601000000006844160247

Daňový doklad FAKTURA
Číslo faktury : 2600200

Odběratel : Jan Novák
Hlavní 12
100 00 Praha 10
E-mail: jan.novak@email.cz

Datum vystavení : 10.09.2026
Datum splatnosti: 24.09.2026

Text Množství Cena Celkem
Přeprava zboží 1 ks 5 000,00 5 000,00

K úhradě : 6 050,00 Kč
Základ daně : 5 000,00
Daň : 1 050,00
Sazba DPH : 21 %
`;

describe("diag fo", () => {
  it("fo invoice", () => {
    const result = parseInvoiceText({ text: foInvoice, fileUrl: "x", organization });
    console.log(JSON.stringify(result.invoice, null, 2));
    console.log("WARNINGS:", JSON.stringify(result.warnings, null, 2));
  });
});
