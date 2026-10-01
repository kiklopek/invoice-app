import { describe, expect, it } from "vitest";
import { DAMAGED_TEXT_LAYER_WARNING, omitUnverifiedOcrValues, parseInvoiceText, type InvoiceOcrResult, type OcrFieldName } from "./invoice-ocr";
import { OCR_CORPUS, type CorpusDocument } from "./invoice-ocr-corpus.fixtures";
import { geminiExtractionToResult, type GeminiExtraction } from "./invoice-ocr-gemini";
import { mergeOcrSources } from "./invoice-ocr-sources";

// Korpusový test: měří parser i celý vícezdrojový řetězec na skutečných
// fakturách. Pravidlo je jedno pro všechna pole: buď přesná hodnota, nebo
// viditelné "k ověření" -- nikdy špatná hodnota se stavem "ověřeno" a nikdy
// špatná hodnota, která by po odfiltrování neověřených polí zůstala ve formuláři.

function fieldValue(result: InvoiceOcrResult, field: OcrFieldName) {
  return (result.invoice as unknown as Record<OcrFieldName, string | number | undefined>)[field] ?? "";
}

function same(field: OcrFieldName, actual: string | number, expected: string | number) {
  if (typeof expected === "number") return Math.abs(Number(actual) - expected) < 0.005;
  if (field === "counterparty_email") return String(actual).toLowerCase() === expected.toLowerCase();
  return String(actual).trim() === expected;
}

function isEmpty(value: string | number) {
  return typeof value === "number" ? value === 0 : value.trim() === "";
}

function expectNeverSilentlyWrong(document: CorpusDocument, result: InvoiceOcrResult) {
  const problems: string[] = [];
  for (const [field, expected] of Object.entries(document.expected) as Array<[OcrFieldName, string | number]>) {
    const actual = fieldValue(result, field);
    const status = result.field_decisions[field]?.status;
    if (isEmpty(actual) || same(field, actual, expected)) continue;
    if (status === "verified") problems.push(`${field}: "${actual}" (čekáno "${expected}") je označeno jako ověřené`);
  }
  // Co zůstane po odfiltrování neověřených hodnot, jde rovnou do formuláře.
  const prefilled = omitUnverifiedOcrValues(result);
  for (const [field, expected] of Object.entries(document.expected) as Array<[OcrFieldName, string | number]>) {
    const actual = fieldValue(prefilled, field);
    if (isEmpty(actual) || same(field, actual, expected)) continue;
    // vat_rate 0 u dokladu bez DPH je platná hodnota, ne "prázdno".
    problems.push(`${field}: formulář by předvyplnil "${actual}" místo "${expected}"`);
  }
  expect(problems).toEqual([]);
}

describe("OCR korpus skutečných faktur -- lokální parser", () => {
  for (const document of OCR_CORPUS) {
    describe(document.description, () => {
      const result = parseInvoiceText({ text: document.text, fileUrl: "org/corpus.pdf", organization: document.organization });

      it("nikdy neoznačí špatnou hodnotu jako ověřenou ani ji nepředvyplní", () => {
        expectNeverSilentlyWrong(document, result);
      });

      it("přečte klíčová pole přesně", () => {
        const read = Object.fromEntries(document.mustRead.map(field => [field, fieldValue(result, field)]));
        const expected = Object.fromEntries(document.mustRead.map(field => [field, document.expected[field]]));
        expect(read).toEqual(expected);
      });

      it("pozná druh dokladu", () => {
        expect(result.document_kind).toBe(document.expectedKind);
      });
    });
  }

  it("u textové vrstvy bez č/ě/ř přidá viditelné varování o poškozeném textu", () => {
    const damaged = OCR_CORPUS.find(document => document.id.endsWith("dropped-glyphs"))!;
    const intact = OCR_CORPUS.find(document => document.id === "self-billed-1443260157")!;
    expect(parseInvoiceText({ text: damaged.text, fileUrl: "org/x.pdf", organization: damaged.organization }).warnings)
      .toContain(DAMAGED_TEXT_LAYER_WARNING);
    expect(parseInvoiceText({ text: intact.text, fileUrl: "org/x.pdf", organization: intact.organization }).warnings)
      .not.toContain(DAMAGED_TEXT_LAYER_WARNING);
  });

  it("u samofakturace předvyplní e-mail z kontaktu vystavitele s potvrzením", () => {
    const document = OCR_CORPUS.find(item => item.id === "self-billed-1443260157")!;
    const result = parseInvoiceText({ text: document.text, fileUrl: "org/x.pdf", organization: document.organization });
    expect(result.invoice.counterparty_email).toBe("katerina.novakova@timber-pulp.cz");
    expect(result.field_decisions.counterparty_email).toMatchObject({ status: "review", needs_confirmation: true });
    expect(omitUnverifiedOcrValues(result).invoice.counterparty_email).toBe("katerina.novakova@timber-pulp.cz");
  });

  it("u běžné faktury nepřiřadí odběrateli kontakt vystavitele z patičky", () => {
    const document = OCR_CORPUS.find(item => item.id === "self-billed-1443260157")!;
    const text = document.text.replace("VYSTAVENO ZÁKAZNÍKEM", "");
    const result = parseInvoiceText({ text, fileUrl: "org/x.pdf", organization: document.organization });
    expect(result.invoice.counterparty_email).toBe("");
  });

  it("nevezme číslo faktury z čísla zákona ani DIČ spojené s následujícím popiskem", () => {
    const advance = OCR_CORPUS.find(document => document.id === "advance-426198")!;
    const result = parseInvoiceText({ text: advance.text, fileUrl: "org/x.pdf", organization: advance.organization });
    expect(result.invoice.invoice_number).not.toContain("302");
    expect(result.invoice.counterparty_dic).toBe("CZ31415920");
  });
});

// Odpověď Gemini se v testech nikdy nevolá -- podvrhujeme její JSON a necháme
// ho projít stejnou konverzí jako v produkci (geminiExtractionToResult).
function aiFor(document: CorpusDocument, payload: GeminiExtraction) {
  return geminiExtractionToResult(payload, {
    organization: document.organization,
    fileUrl: "org/corpus.pdf",
    model: "gemini-test",
    responseId: "resp-test",
  });
}

function evidence(fields: string[], role: "counterparty" | "document" | "issuer" = "document") {
  return Object.fromEntries(fields.map(field => [field, { page: 1, text: field, party_role: field.startsWith("counterparty_") ? (role === "document" ? "counterparty" : role) : "document" }]));
}

describe("OCR korpus -- lokální parser + AI (Gemini podvržená)", () => {
  const selfBilled = OCR_CORPUS.find(document => document.id === "self-billed-1443260157-dropped-glyphs")!;
  const advance = OCR_CORPUS.find(document => document.id === "advance-426198")!;

  it("samofakturace: AI, která vezme vystavitele za odběratele, nepřepíše odběratele ani ho neoznačí jako ověřeného", () => {
    const local = parseInvoiceText({ text: selfBilled.text, fileUrl: "org/x.pdf", organization: selfBilled.organization });
    // Typická chyba modelu u "VYSTAVENO ZÁKAZNÍKEM": vezme za protistranu
    // firmu z hlavičky, tedy nás samotné.
    const ai = aiFor(selfBilled, {
      invoice_number: "1443260157",
      counterparty_name: "M. Kolar, s.r.o.",
      counterparty_ico: "16180330",
      counterparty_dic: "CZ16180330",
      issue_date: "2026-09-15",
      due_date: "2026-09-23",
      amount_without_vat: 101735.7,
      vat_rate: 21,
      amount: 123100.2,
      currency: "CZK",
      evidence: evidence(["invoice_number", "counterparty_name", "counterparty_ico", "counterparty_dic", "issue_date", "due_date", "amount_without_vat", "vat_rate", "amount", "currency"], "counterparty"),
    });
    const merged = mergeOcrSources({ local, ai, organization: selfBilled.organization });
    expectNeverSilentlyWrong(selfBilled, merged);
    expect(merged.invoice.counterparty_ico).not.toBe("16180330");
  });

  it("samofakturace: shoda lokálního parseru a AI ověří i e-mail z kontaktu vystavitele", () => {
    const local = parseInvoiceText({ text: selfBilled.text, fileUrl: "org/x.pdf", organization: selfBilled.organization });
    const ai = aiFor(selfBilled, {
      invoice_number: "1443260157",
      counterparty_name: "TIMBER & PULP a.s.",
      counterparty_ico: "46692011",
      counterparty_dic: "CZ46692011",
      counterparty_email: "katerina.novakova@timber-pulp.cz",
      issue_date: "2026-09-15",
      due_date: "2026-09-23",
      amount_without_vat: 101735.7,
      vat_rate: 21,
      amount: 123100.2,
      currency: "CZK",
      document_kind: "issued_invoice",
      evidence: evidence(["invoice_number", "counterparty_name", "counterparty_ico", "counterparty_dic", "counterparty_email", "issue_date", "due_date", "amount_without_vat", "vat_rate", "amount", "currency"]),
    });
    const merged = mergeOcrSources({ local, ai, organization: selfBilled.organization });
    expectNeverSilentlyWrong(selfBilled, merged);
    for (const field of ["counterparty_name", "counterparty_ico", "amount", "issue_date"] as const) {
      expect(merged.field_decisions[field]?.status, field).toBe("verified");
    }
    // Oba nezávislé zdroje přečetly stejný e-mail odběratele.
    const prefilled = omitUnverifiedOcrValues(merged);
    expect(prefilled.invoice.counterparty_email).toBe("katerina.novakova@timber-pulp.cz");
    expect(merged.field_decisions.counterparty_email).toMatchObject({ status: "verified" });
  });

  it("zálohovka: AI druh dokladu 'proforma' se převezme a číslo zákona nevyhraje nad číslem faktury", () => {
    const local = parseInvoiceText({ text: advance.text, fileUrl: "org/x.pdf", organization: advance.organization });
    const ai = aiFor(advance, {
      invoice_number: "426198",
      counterparty_name: "KZ - STAVBY plus s.r.o.",
      counterparty_ico: "31415920",
      counterparty_dic: "CZ31415920",
      issue_date: "2026-09-02",
      due_date: "2026-09-16",
      amount_without_vat: 3370,
      vat_rate: 0,
      amount: 3370,
      currency: "CZK",
      document_kind: "proforma",
      evidence: evidence(["invoice_number", "counterparty_name", "counterparty_ico", "counterparty_dic", "issue_date", "due_date", "amount_without_vat", "amount", "currency"]),
    });
    const merged = mergeOcrSources({ local, ai, organization: advance.organization });
    expectNeverSilentlyWrong(advance, merged);
    expect(merged.document_kind).toBe("proforma");
    expect(merged.invoice.invoice_number).toBe("426198");
    expect(merged.field_decisions.invoice_number?.status).toBe("verified");
  });
});
