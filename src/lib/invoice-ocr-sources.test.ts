import { describe, expect, it } from "vitest";
import { deriveOcrFieldDecisions, omitUnverifiedOcrValues, type InvoiceOcrResult, type OcrFieldName, type OcrFieldSource } from "./invoice-ocr";
import { OCR_VOCABULARY_VERSION } from "./invoice-ocr-vocabulary";
import { applyOcrConsistencyChecks, mergeOcrSources, type ExactSourceReading } from "./invoice-ocr-sources";
import type { InvoiceInput } from "@/types/invoice";

const organization = { name: "M. Kolar, s.r.o.", ico: "16180330", dic: "CZ16180330" };

const invoice: InvoiceInput = {
  invoice_number: "1443260157", counterparty_name: "TIMBER & PULP a.s.", counterparty_ico: "46692011",
  counterparty_dic: "CZ46692011", counterparty_email: "", variable_symbol: "1443260157",
  amount_without_vat: 101735.7, vat_rate: 21, amount: 123100.2, currency: "CZK",
  issue_date: "2026-09-15", due_date: "2026-09-23", source: "ocr",
  money_evidence: { original_total: 123100.2, total_source: "read", adjustment: 0, adjustment_reason: "", adjustment_confirmed: false, initial_paid: 0, initial_paid_confirmed: false, multi_rate: false },
};

function result(method: OcrFieldSource["method"], overrides: Partial<InvoiceInput> = {}): InvoiceOcrResult {
  const merged = { ...invoice, ...overrides };
  const sources = Object.fromEntries((Object.keys(merged) as OcrFieldName[])
    .filter(field => ["invoice_number", "counterparty_name", "counterparty_ico", "counterparty_dic", "variable_symbol", "amount_without_vat", "vat_rate", "amount", "currency", "issue_date", "due_date"].includes(field))
    .map(field => [field, { page: 1, line: 1, text: String(merged[field as keyof InvoiceInput]), method, confidence: method === "ai" ? 0.65 : null, bounds: null, role: field.startsWith("counterparty_") ? "counterparty" : "document" }])) as Partial<Record<OcrFieldName, OcrFieldSource>>;
  return {
    invoice: merged, field_sources: sources, field_decisions: deriveOcrFieldDecisions(merged, sources, []),
    confidence: 0.9, warnings: [], document_kind: "issued_invoice", issuer_matches_organization: true,
    model: method, response_id: null, vocabulary_version: OCR_VOCABULARY_VERSION, keyword_suggestions: [],
  };
}

const isdoc = (values: ExactSourceReading["values"], extra: Partial<ExactSourceReading> = {}): ExactSourceReading => ({ method: "isdoc", label: "ISDOC příloha f.isdoc", values, ...extra });
const qr = (values: ExactSourceReading["values"]): ExactSourceReading => ({ method: "qr", label: "QR platba", values });

describe("pořadí zdrojů ISDOC > QR > ARES > AI > text", () => {
  it.each([
    "invoice_number", "variable_symbol", "issue_date", "due_date",
    "counterparty_name", "counterparty_ico", "counterparty_dic",
    "counterparty_email", "amount_without_vat", "vat_rate", "amount", "currency",
  ] as OcrFieldName[])("předvyplní jednoznačně přečtené pole %s i s upozorněním ke kontrole", field => {
    const reading = result("pdf_text", { counterparty_email: "ucetni@timber-pulp.cz" });
    const value = reading.invoice[field];
    reading.field_sources[field] = { ...reading.field_sources.counterparty_name!, text: String(value), confidence: 0.5,
      role: field.startsWith("counterparty_") ? "counterparty" : "document" };
    reading.field_decisions = deriveOcrFieldDecisions(reading.invoice, reading.field_sources, []);
    expect(reading.field_decisions[field]?.status).toBe("review");
    const prefilled = omitUnverifiedOcrValues(reading, organization);
    expect(prefilled.invoice[field]).toBe(value);
    expect(prefilled.field_decisions[field]).toMatchObject({ status: "review", needs_confirmation: true });
    expect(prefilled.field_sources[field]).toEqual(reading.field_sources[field]);
    expect(omitUnverifiedOcrValues(prefilled, organization).invoice[field]).toBe(value);
  });

  it("přesný zdroj bez rozporu dá ověřené pole se svým zdrojem", () => {
    const merged = mergeOcrSources({ local: result("pdf_text"), exact: [qr({ amount: 123100.2, variable_symbol: "1443260157" })], organization });
    expect(merged.field_sources.amount?.method).toBe("qr");
    expect(merged.field_decisions.amount).toMatchObject({ status: "verified" });
    expect(merged.field_decisions.amount?.reasons[0]).toContain("shoduje se s: text PDF");
  });

  it("ISDOC vyplní pole, která text ani AI nepřečetly", () => {
    const merged = mergeOcrSources({ local: result("pdf_text", { invoice_number: "", counterparty_email: "" }), exact: [isdoc({ invoice_number: "1443260157", counterparty_email: "ucetni@timber-pulp.cz" })], organization });
    expect(merged.invoice).toMatchObject({ invoice_number: "1443260157", counterparty_email: "ucetni@timber-pulp.cz" });
    expect(merged.field_decisions.invoice_number?.status).toBe("verified");
  });

  it("ISDOC a QR se neshodují na částce: pole prázdné, obě hodnoty k volbě", () => {
    const merged = mergeOcrSources({ local: result("pdf_text"), exact: [isdoc({ amount: 123100.2 }), qr({ amount: 123000 })], organization });
    expect(merged.invoice.amount).toBe(0);
    expect(merged.field_decisions.amount?.status).toBe("review");
    expect(merged.field_decisions.amount?.candidates.map(candidate => [candidate.method, candidate.value])).toEqual([["isdoc", 123100.2], ["qr", 123000], ["pdf_text", 123100.2]]);
    expect(omitUnverifiedOcrValues(merged).invoice.amount).toBe(0);
  });

  it("přesný zdroj proti čtení dokumentu: žádný tichý vítěz ani pro ISDOC", () => {
    const merged = mergeOcrSources({ local: result("pdf_text", { variable_symbol: "1443260158" }), exact: [isdoc({ variable_symbol: "1443260157" })], organization });
    expect(merged.invoice.variable_symbol).toBe("");
    expect(merged.field_decisions.variable_symbol?.candidates.map(candidate => candidate.value)).toEqual(["1443260157", "1443260158"]);
    expect(merged.warnings.some(warning => warning.startsWith("Zdroje se neshodují na poli variabilní symbol"))).toBe(true);
  });

  it("QR částka k úhradě po odečtení zálohy není rozpor s celkovou hodnotou", () => {
    const local = result("pdf_text");
    local.invoice.money_evidence = { ...local.invoice.money_evidence!, initial_paid: 23100.2 };
    const merged = mergeOcrSources({ local, exact: [qr({ amount: 100000 })], organization });
    expect(merged.invoice.amount).toBe(123100.2);
    expect(merged.field_decisions.amount?.status).toBe("verified");
  });

  it("AI má přednost před textem jen tehdy, když se shodnou -- rozpor jde k ověření", () => {
    const merged = mergeOcrSources({ local: result("pdf_text"), ai: result("ai", { invoice_number: "1443260175" }), organization });
    expect(merged.invoice.invoice_number).toBe("");
    expect(merged.field_decisions.invoice_number?.status).toBe("review");
  });

  it("vezme druh dokladu z ISDOC a rozdíl oznámí", () => {
    const merged = mergeOcrSources({ local: result("pdf_text"), exact: [isdoc({}, { document_kind: "proforma" })], organization });
    expect(merged.document_kind).toBe("proforma");
    expect(merged.warnings.some(warning => warning.includes("ISDOC"))).toBe(true);
  });
});

describe("kontroly nad výsledkem", () => {
  it("odmítne vlastní doménu vystavitele i z AI a ISDOC", () => {
    const issuer = { name: "R. Hlavica s.r.o.", ico: "26296039", dic: "CZ26296039", email: "info@hlavica.cz" };
    const ai = mergeOcrSources({ ai: result("ai", { counterparty_email: "kostihova@hlavica.cz" }), organization: issuer });
    expect(ai.invoice.counterparty_email).toBe("");
    expect(ai.field_decisions.counterparty_email).toMatchObject({ status: "review" });
    expect(ai.field_decisions.counterparty_email?.candidates[0].role).toBe("issuer");

    const exact = mergeOcrSources({ local: result("pdf_text"), exact: [isdoc({ counterparty_email: "kostihova@hlavica.cz" })], organization: issuer });
    expect(exact.invoice.counterparty_email).toBe("");
    expect(exact.warnings.join(" ")).toContain("E-mail patří vystaviteli");
  });

  it("základ + DPH ≠ celkem: hodnoty zůstanou, ale čekají na potvrzení", () => {
    const checked = applyOcrConsistencyChecks(result("pdf_text", { amount: 125000 }), organization);
    for (const field of ["amount", "amount_without_vat", "vat_rate"] as const) {
      expect(checked.field_decisions[field]).toMatchObject({ status: "review", needs_confirmation: true });
    }
    expect(checked.field_decisions.amount?.reasons.join(" ")).toContain("nedává celkovou částku");
  });

  it("splatnost před vystavením se nepředvyplní", () => {
    const checked = applyOcrConsistencyChecks(result("ai", { due_date: "2026-09-01" }), organization);
    expect(checked.invoice.due_date).toBe("");
    expect(checked.field_decisions.due_date?.candidates.map(candidate => candidate.value)).toContain("2026-09-01");
  });

  it("VS s písmeny nebo delší než 10 číslic se nepředvyplní", () => {
    expect(applyOcrConsistencyChecks(result("ai", { variable_symbol: "FV-2026-7" }), organization).invoice.variable_symbol).toBe("");
    expect(applyOcrConsistencyChecks(result("ai", { variable_symbol: "12345678901" }), organization).invoice.variable_symbol).toBe("");
  });

  it("IČO s chybnou kontrolní číslicí a DIČ firmy neodpovídající IČO jdou k ověření", () => {
    expect(applyOcrConsistencyChecks(result("ai", { counterparty_ico: "46692012", counterparty_dic: "" }), organization).invoice.counterparty_ico).toBe("");
    const checked = applyOcrConsistencyChecks(result("ai", { counterparty_dic: "CZ27182819" }), organization);
    expect(checked.invoice.counterparty_dic).toBe("");
    expect(checked.field_decisions.counterparty_dic?.reasons.join(" ")).toContain("neodpovídá IČO");
  });

  it("DIČ fyzické osoby (rodné číslo) se s IČO nesrovnává", () => {
    expect(applyOcrConsistencyChecks(result("ai", { counterparty_dic: "CZ7901011239" }), organization).invoice.counterparty_dic).toBe("CZ7901011239");
  });
});

describe("geometrie zdroje pro zvýraznění v náhledu dokladu", () => {
  const box = (y: number) => ({ x: 0.12, y, width: 0.3, height: 0.015 });
  // Lokální čtení, u kterého každé pole leží na vlastním řádku stránky 2.
  function localWithBounds(overrides: Partial<InvoiceInput> = {}) {
    const local = result("pdf_text", overrides);
    let y = 0.1;
    for (const field of Object.keys(local.field_sources) as OcrFieldName[]) {
      local.field_sources[field] = { ...local.field_sources[field]!, page: 2, line: Math.round(y * 100), text: `řádek ${field}`, bounds: box(y) };
      y += 0.03;
    }
    local.field_decisions = deriveOcrFieldDecisions(local.invoice, local.field_sources, []);
    return local;
  }

  it("QR potvrdí stejnou částku: zdroj zůstane QR, ale převezme stránku a box lokálního řádku", () => {
    const local = localWithBounds();
    const merged = mergeOcrSources({ local, exact: [qr({ amount: 123100.2, variable_symbol: "1443260157" })], organization });
    for (const field of ["amount", "variable_symbol"] as const) {
      expect(merged.field_sources[field]).toMatchObject({
        method: "qr", page: 2, line: local.field_sources[field]!.line, text: local.field_sources[field]!.text, bounds: local.field_sources[field]!.bounds,
      });
      expect(merged.field_decisions[field]?.candidates[0]).toMatchObject({ method: "qr", page: 2, bounds: local.field_sources[field]!.bounds });
    }
    expect(merged.field_decisions.amount?.status).toBe("verified");
  });

  it("ISDOC se stejným datem, IČO a jménem v jiném zápisu převezme box lokálního řádku", () => {
    const local = localWithBounds();
    const merged = mergeOcrSources({ local, exact: [isdoc({ due_date: "2026-09-23", counterparty_ico: "46 69 20 11", counterparty_name: "Timber & Pulp A.S." })], organization });
    expect(merged.field_sources.due_date).toMatchObject({ method: "isdoc", page: 2, bounds: local.field_sources.due_date!.bounds });
    expect(merged.field_sources.counterparty_ico).toMatchObject({ method: "isdoc", page: 2, bounds: local.field_sources.counterparty_ico!.bounds });
    expect(merged.field_sources.counterparty_name).toMatchObject({ method: "isdoc", page: 2, bounds: local.field_sources.counterparty_name!.bounds });
  });

  it("částka v toleranci, ale jiná v haléřích: box se NEpůjčí, ukazoval by jiné číslo", () => {
    const local = localWithBounds();
    const merged = mergeOcrSources({ local, exact: [isdoc({ amount: 123100.24 })], organization });
    // Hodnotové chování zůstává, jak bylo (tolerance pro shodu zdrojů).
    expect(merged.invoice.amount).toBe(123100.24);
    expect(merged.field_sources.amount).toMatchObject({ method: "isdoc", bounds: null });
    expect(merged.field_decisions.amount?.candidates[0].bounds ?? null).toBeNull();
  });

  it("dopočtené lokální pole box nepůjčí -- leží na řádku jiné hodnoty", () => {
    const local = localWithBounds();
    local.field_sources.amount_without_vat = { ...local.field_sources.amount!, method: "derived" };
    local.field_decisions = deriveOcrFieldDecisions(local.invoice, local.field_sources, []);
    expect(local.field_decisions.amount_without_vat?.candidates[0].bounds).toBeUndefined();
    const merged = mergeOcrSources({ local, exact: [isdoc({ amount_without_vat: 101735.7 })], organization });
    expect(merged.field_sources.amount_without_vat).toMatchObject({ method: "isdoc", bounds: null });
  });

  it("rozpor zdrojů: box dostane jen kandidát se stejnou hodnotou jako lokální řádek", () => {
    const local = localWithBounds();
    const merged = mergeOcrSources({ local, exact: [isdoc({ amount: 123100.2 }), qr({ amount: 123000 })], organization });
    const candidates = merged.field_decisions.amount?.candidates ?? [];
    expect(candidates.map(candidate => [candidate.method, candidate.value, candidate.bounds ?? null])).toEqual([
      ["isdoc", 123100.2, local.field_sources.amount!.bounds],
      ["qr", 123000, null],
      ["pdf_text", 123100.2, local.field_sources.amount!.bounds],
    ]);
    expect(candidates.filter(candidate => candidate.bounds).every(candidate => candidate.page === 2)).toBe(true);
  });

  it("AI shodná s lokálním čtením a QR: box lokálního řádku projde celým řetězcem", () => {
    const local = localWithBounds();
    const merged = mergeOcrSources({ local, ai: result("ai"), exact: [qr({ amount: 123100.2 })], organization });
    expect(merged.field_sources.amount).toMatchObject({ method: "qr", page: 2, bounds: local.field_sources.amount!.bounds });
  });

  it("AI vyplní pole, které lokální parser nabídl jen jako kandidáta: převezme jeho box, metoda zůstane AI", () => {
    const local = localWithBounds({ counterparty_ico: "" });
    delete local.field_sources.counterparty_ico;
    local.field_decisions = deriveOcrFieldDecisions(local.invoice, local.field_sources, []);
    local.field_decisions.counterparty_ico = {
      status: "review", confidence: 0.4, reasons: ["V potvrzené sekci odběratele bylo nalezeno více možných hodnot."],
      candidates: [
        { value: "46692011", page: 3, text: "IČO: 46692011", method: "pdf_text", confidence: null, role: "counterparty", bounds: box(0.5) },
        { value: "27182818", page: 3, text: "IČO: 27182818", method: "pdf_text", confidence: null, role: "counterparty", bounds: box(0.6) },
      ],
    };
    const merged = mergeOcrSources({ local, ai: result("ai"), organization });
    expect(merged.invoice.counterparty_ico).toBe("46692011");
    expect(merged.field_sources.counterparty_ico).toMatchObject({ method: "ai", page: 3, bounds: box(0.5) });
  });

  it("AI přebije lokální hodnotu, která se liší: box lokálního řádku se nepůjčí", () => {
    const local = localWithBounds({ counterparty_email: "ucetni@timber-pulp.cz" });
    local.field_sources.counterparty_email = { page: 2, line: 9, text: "ucetni@timber-pulp.cz", method: "pdf_text", confidence: 0.5, bounds: box(0.9), role: "counterparty" };
    const ai = result("ai", { counterparty_email: "faktury@timber-pulp.cz" });
    ai.field_sources.counterparty_email = { page: 1, line: 0, text: "faktury@timber-pulp.cz", method: "ai", confidence: 0.65, bounds: null, role: "counterparty" };
    const merged = mergeOcrSources({ local, ai, organization });
    expect(merged.invoice.counterparty_email).toBe("faktury@timber-pulp.cz");
    expect(merged.field_sources.counterparty_email).toMatchObject({ method: "ai", bounds: null });
  });
});
