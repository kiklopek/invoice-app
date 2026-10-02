import { describe, expect, it } from "vitest";
import { omitUnverifiedOcrValues, parseInvoiceText } from "./invoice-ocr";
import { currencyMentions } from "./invoice-currency";

// Měna u částky: stížnost z provozu -- „i když je to u částky výslovně
// napsané, OCR měnu nezapíše“. Každý případ je zápis, který se na
// skutečných fakturách běžně objevuje.
const organization = { name: "Dodavatel s.r.o.", ico: "27182819", dic: "CZ27182819" };
const head = [
  "FAKTURA", "Číslo faktury: 2026001", "Dodavatel: Dodavatel s.r.o.", "IČO: 27182819",
  "Odběratel: Odběr a.s.", "IČO: 31415920", "Datum vystavení: 01.09.2026", "Datum splatnosti: 15.09.2026",
].join("\n");
const parse = (body: string) => parseInvoiceText({ text: `${head}\n${body}`, fileUrl: "org/x.pdf", organization });

describe("měna zapsaná přímo u částky", () => {
  it.each([
    ["Celkem k úhradě: € 1,234.50", 1234.5, "EUR"],
    ["Celkem k úhradě: €1,234.50", 1234.5, "EUR"],
    ["Total due: USD 1,250.00", 1250, "USD"],
    ["Amount due: US$1,250.00", 1250, "USD"],
    ["Total: £1,200.00", 1200, "GBP"],
    ["Zu zahlen: 1.234,50 €", 1234.5, "EUR"],
    ["Gesamtbetrag: 1.234,50 EUR", 1234.5, "EUR"],
    ["Do zapłaty: 1 234,50 zł", 1234.5, "PLN"],
    ["Total CHF 1'234.50", 1234.5, "CHF"],
    ["Celkem k úhradě: 1 234,50 Kč", 1234.5, "CZK"],
    ["Celkem k úhradě: 1 234,50 eur", 1234.5, "EUR"],
  ])("%s → %s %s, ověřeno", (line, amount, currency) => {
    const result = parse(line);
    expect(result.invoice.amount).toBe(amount);
    expect(result.invoice.currency).toBe(currency);
    expect(result.field_decisions.currency?.status).toBe("verified");
  });

  it("anglický oddělovač tisíců nikdy nezkrátí částku na její konec", () => {
    // Dřív: „1,234.50“ → 234,50 jako ověřená hodnota.
    const result = parse("Subtotal: EUR 1,000.00\nVAT 21 %: EUR 210.00\nTotal due: EUR 1,210.00");
    expect(result.invoice.amount).toBe(1210);
    expect(result.invoice.amount_without_vat).toBe(1000);
  });

  it("česká čárka u množství se nečte jako oddělovač tisíců", () => {
    const result = parse("Smrk 1,920 M3 2 810,00 5 395,20\nK úhradě 6 528,19 Kč");
    expect(result.invoice.amount).toBe(6528.19);
    expect(result.invoice.currency).toBe("CZK");
  });

  it("přenese samostatně uvedenou měnu částky až do návrhu formuláře", () => {
    const result = parse("K úhradě: 3 202 315,00\nMěna: PLN");
    expect(result.invoice.currency).toBe("PLN");
    const safe = omitUnverifiedOcrValues(result, organization);
    expect(safe.invoice.currency).toBe("PLN");
    expect(safe.field_decisions.currency?.status).toBe("verified");
  });

  it("neztratí měnu uvedenou mimo sousední řádek částky", () => {
    const result = parse("K úhradě: 3 202 315,00\nÚčet: 123456789/0100\nDatum platby: 15.09.2026\nMěna faktury: PLN");
    expect(result.invoice.currency).toBe("PLN");
    expect(omitUnverifiedOcrValues(result, organization).invoice.currency).toBe("PLN");
  });

  it("ponechá měnu přímo u celkové částky, i když je v jiném oddílu uvedena další měna", () => {
    const result = parse("Bankovní účet vedený v CZK\nK úhradě: 3 202 315,00 PLN");
    expect(result.invoice.currency).toBe("PLN");
    expect(omitUnverifiedOcrValues(result, organization).invoice.currency).toBe("PLN");
  });

  it("propíše Kč u částky i při dalším přepočtu na stejném řádku", () => {
    const result = parse("K úhradě: 3 750,00 Kč (orientační kurz EUR)");
    expect(result.invoice.amount).toBe(3750);
    expect(result.invoice.currency).toBe("CZK");
    expect(omitUnverifiedOcrValues(result, organization).invoice.currency).toBe("CZK");
  });

  it("samotný $ nepředpokládá CZK, ale nabídne dolarové měny k výběru", () => {
    const result = parse("Amount due: $1,250.00");
    expect(result.invoice.amount).toBe(1250);
    expect(result.invoice.currency).toBe("");
    const decision = result.field_decisions.currency!;
    expect(decision.status).toBe("review");
    expect(decision.candidates.map(candidate => candidate.value)).toEqual(["USD", "CAD", "AUD"]);
    expect(decision.reasons.join(" ")).toMatch(/\$/);
    expect(decision.reasons.join(" ")).not.toMatch(/Předpokládá se CZK/);
    // Ani filtr před odesláním do formuláře měnu nedoplní.
    expect(omitUnverifiedOcrValues(result, organization).invoice.currency).toBe("");
  });
});

describe("symboly měn přilepené k číslu", () => {
  it.each([
    ["£1,200.00", "GBP"], ["€1 234", "EUR"], ["1 234,50€", "EUR"], ["US$1,250", "USD"], ["CHF1'234.50", "CHF"],
  ])("%s → %s", (text, currency) => {
    expect(currencyMentions(text)).toEqual([currency]);
  });

  it("písmenný kód uvnitř slova měnou není", () => {
    expect(currencyMentions("NEUROLOGIE, Kceňa")).toEqual([]);
  });
});
