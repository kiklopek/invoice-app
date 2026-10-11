import { describe, expect, it } from "vitest";
import {
  defaultInvoiceQuery,
  invoiceFit,
  plainProposalReason,
  rankCandidates,
  reviewAllocations,
  reviewPayment,
  summarize,
  type ReviewChoice,
  type ReviewEntry,
  type ReviewInvoice,
} from "./payment-review-model";
import { bookButtonLabel, commitSummary, commitTitle, remainingNotice } from "./payment-review-copy";

const invoice = (id: string, amount: number, paid = 0, variable_symbol: string | null = null): ReviewInvoice => ({
  id, invoice_number: id.toUpperCase(), counterparty_name: "Odběratel", amount, paid_amount: paid, currency: "CZK", variable_symbol,
});
const invoices = new Map([
  ["a", invoice("a", 12100, 0, "20260001")],
  ["b", invoice("b", 4840, 0, "20260002")],
  ["c", invoice("c", 10000, 2000, "20260003")],
]);
const entry = (overrides: Partial<ReviewEntry> = {}): ReviewEntry => ({
  disposition: "accepted", reason: null, amount: 12100, currency: "CZK", variable_symbol: "20260001",
  counterparty_name: "Novák stavby s.r.o.", bank_payment_id: null, processing_error: null,
  overlap_warning: false, overlap_acknowledged_by: null, proposal_kind: null, proposal_confidence: null,
  proposal_reason: null, proposed_invoice_ids: [], ...overrides,
});
const review = (e: Partial<ReviewEntry>, choice: Partial<ReviewChoice> = {}) =>
  reviewPayment(entry(e), { selectedIds: [], ...choice }, invoices);

describe("tři krabice: hotovo, potřebuje odpověď, nesouvisí", () => {
  it("řádky, které nejsou příchozí platbou, nikdy nežádají odpověď", () => {
    expect(review({ disposition: "ignored", amount: -2500 })).toMatchObject({ bucket: "not_invoice", status: "outgoing", editable: false });
    expect(review({ disposition: "ignored", amount: 100, reason: "Platba v cizí měně" }).plainReason).toBe("Platba v cizí měně. K fakturám se nepřiřazuje.");
    expect(review({ disposition: "duplicate" })).toMatchObject({ bucket: "not_invoice", status: "duplicate" });
    expect(review({ disposition: "error", reason: "Řádek nemá platnou částku." }).plainReason).toBe("Řádek výpisu se nepodařilo přečíst: Řádek nemá platnou částku. Nic se nezapíše.");
  });

  it("zaúčtovaná platba je hotová a říká, proč ji automat zaúčtoval", () => {
    expect(review({ bank_payment_id: "p" })).toMatchObject({ bucket: "done", status: "booked", plainReason: "Zaúčtováno.", editable: false });
    expect(review({ bank_payment_id: "p" }, { autoReason: "Sedí VS i částka" }).plainReason).toBe("Zaúčtováno automaticky: sedí VS i částka.");
  });

  it("zaúčtování má přednost i před starým označením „nesouvisí“", () => {
    expect(review({ bank_payment_id: "p" }, { unrelated: true }).status).toBe("booked");
  });

  it("„nesouvisí s fakturami“ a vlastní převod jsou mimo faktury, ale jdou vrátit", () => {
    expect(review({}, { unrelated: true })).toMatchObject({ bucket: "not_invoice", status: "unrelated", editable: true });
    expect(review({}, { unrelated: true, ownTransferReason: "Platba přišla z účtu firmy" })).toMatchObject({
      status: "own_transfer", plainReason: "Převod mezi vašimi účty: platba přišla z účtu firmy.",
    });
  });

  it("potvrzená duplicita se přeskočí jako nesouvisející řádek", () => {
    expect(review({ overlap_warning: true }, { unrelated: true, duplicateSkipped: true })).toMatchObject({
      bucket: "not_invoice", plainReason: "Stejná platba jako v jiném výpisu – podruhé se nezapíše.",
    });
  });

  it("možná duplicita se musí potvrdit, i když je faktura vybraná", () => {
    expect(review({ overlap_warning: true }, { selectedIds: ["a"] })).toMatchObject({ bucket: "needs_answer", status: "possible_duplicate" });
    expect(review({ overlap_warning: true, overlap_acknowledged_by: "u" }, { selectedIds: ["a"] }).status).toBe("ready");
  });

  it("návrh ke kontrole čeká na odpověď a vysvětluje se bez zkratek", () => {
    const result = review({ proposal_kind: "exact", proposal_confidence: "review", proposal_reason: "Stejný plátce, jiný VS", proposed_invoice_ids: ["a"] });
    expect(result).toMatchObject({ bucket: "needs_answer", status: "suggested", suggestionIds: ["a"] });
    expect(result.plainReason).toBe("Stejný plátce, jiný variabilní symbol.");
  });

  it("bez návrhu: žádná faktura, dokud uživatel neodpoví „nechat nespárovanou“", () => {
    expect(review({})).toMatchObject({ bucket: "needs_answer", status: "no_match" });
    expect(review({}, { leftUnmatched: true })).toMatchObject({ bucket: "done", status: "left_unmatched" });
  });

  it("jistý návrh předvybraný serverem je hotový", () => {
    const result = review({ proposal_kind: "exact", proposal_confidence: "safe", proposal_reason: "Sedí variabilní symbol i částka.", proposed_invoice_ids: ["a"] }, { selectedIds: ["a"] });
    expect(result).toMatchObject({ bucket: "done", status: "ready", difference: 0 });
    expect(result.plainReason).toBe("Sedí variabilní symbol i částka. Připraveno k zaúčtování.");
  });

  it("kombinace faktur, která přesně sedí, je hotová", () => {
    expect(review({ amount: 16940 }, { selectedIds: ["a", "b"] })).toMatchObject({ bucket: "done", status: "ready", allocated: 16940 });
  });
});

describe("částky: stejná pravidla jako kontrola v databázi", () => {
  it("menší platba je otázka na částečnou úhradu; odpověď ji uloží jako částku faktury", () => {
    expect(review({ amount: 10000 }, { selectedIds: ["a"] })).toMatchObject({ bucket: "needs_answer", status: "underpaid", difference: -2100 });
    const answered = review({ amount: 10000 }, { selectedIds: ["a"], amounts: { a: 10000 } });
    expect(answered).toMatchObject({ bucket: "done", status: "ready_partial", isPartial: true });
    expect(reviewAllocations(entry({ amount: 10000 }), { selectedIds: ["a"], amounts: { a: 10000 } }, invoices))
      .toEqual([{ invoice_id: "a", amount: 10000, is_manual_partial: false }]);
  });

  it("vyšší platba je otázka na přeplatek; odpověď nastaví is_manual_partial", () => {
    expect(review({ amount: 13000 }, { selectedIds: ["a"] })).toMatchObject({ status: "overpaid", difference: 900 });
    expect(review({ amount: 13000 }, { selectedIds: ["a"], overpaymentAccepted: true })).toMatchObject({ bucket: "done", status: "ready_overpaid" });
    expect(reviewAllocations(entry({ amount: 13000 }), { selectedIds: ["a"], overpaymentAccepted: true }, invoices))
      .toEqual([{ invoice_id: "a", amount: 12100, is_manual_partial: true }]);
  });

  it("přeplatek u více faktur neplatí -- musí se upravit výběr", () => {
    expect(review({ amount: 20000 }, { selectedIds: ["a", "b"], overpaymentAccepted: true }).status).toBe("overpaid");
  });

  it("víc faktur, než pokryje platba, se nedá zaúčtovat", () => {
    expect(review({ amount: 13000 }, { selectedIds: ["a", "b"] })).toMatchObject({ bucket: "needs_answer", status: "over_allocated" });
  });

  it("počítá se zbytek faktury, ne její celá částka", () => {
    expect(review({ amount: 8000 }, { selectedIds: ["c"] })).toMatchObject({ status: "ready", allocated: 8000 });
  });

  it("prázdné nebo neplatné ruční pole se nepočítá jako nula", () => {
    expect(review({ amount: 12100 }, { selectedIds: ["a"], amounts: { a: Number.NaN } }).status).toBe("ready");
  });

  it("platba jako text z databáze se počítá stejně jako číslo", () => {
    expect(review({ amount: "12100.00" }, { selectedIds: ["a"] }).status).toBe("ready");
  });
});

describe("výběr faktury", () => {
  it("ukáže, co sedí, a seřadí podle toho kandidáty", () => {
    const e = entry({ amount: 4840, variable_symbol: "0020260002" });
    expect(invoiceFit(e, invoices.get("b")!)).toMatchObject({ amount: true, symbol: true });
    expect(invoiceFit(e, invoices.get("a")!)).toMatchObject({ amount: false, symbol: false });
    expect(rankCandidates(e, [...invoices.values()]).map((item) => item.id)).toEqual(["b", "a", "c"]);
  });

  it("faktury v jiné měně se nenabízí vůbec", () => {
    const eur = { ...invoice("e", 100), currency: "EUR" };
    expect(rankCandidates(entry(), [eur, invoices.get("a")!]).map((item) => item.id)).toEqual(["a"]);
  });

  it("hledání se předvyplní symbolem, jinak jménem plátce", () => {
    expect(defaultInvoiceQuery({ variable_symbol: "0020260001", counterparty_name: "X" })).toBe("20260001");
    expect(defaultInvoiceQuery({ variable_symbol: null, counterparty_name: "  Novák stavby s.r.o." })).toBe("Novák stavby");
    expect(defaultInvoiceQuery({ variable_symbol: null, counterparty_name: "Mezinárodní stavební, obchodní s.r.o." })).toBe("Mezinárodní stavební");
  });

  it("důvod návrhu bez textu ze serveru je i tak česká věta", () => {
    expect(plainProposalReason({ proposal_reason: null, proposal_kind: "combination", proposed_invoice_ids: ["a", "b"] })).toBe("Součet více faktur odpovídá platbě.");
  });
});

describe("souhrn a texty", () => {
  it("spočítá krabice", () => {
    expect(summarize([review({}), review({ bank_payment_id: "p" }), review({ disposition: "duplicate" }), review({}, { leftUnmatched: true })]))
      .toEqual({ done: 2, needs_answer: 1, not_invoice: 1 });
  });

  it("tlačítko, lišta i dialog skloňují správně", () => {
    expect(bookButtonLabel(1)).toBe("Zaúčtovat 1 platbu");
    expect(bookButtonLabel(3)).toBe("Zaúčtovat 3 platby");
    expect(bookButtonLabel(9)).toBe("Zaúčtovat 9 plateb");
    expect(remainingNotice(1)).toBe("1 platba zůstane nespárovaná, dořešíte ji později v Platbách.");
    expect(remainingNotice(3)).toBe("3 platby zůstanou nespárované, dořešíte je později v Platbách.");
    expect(remainingNotice(7)).toBe("7 plateb zůstane nespárovaných, dořešíte je později v Platbách.");
    expect(commitTitle(9, 8)).toBe("Zaúčtovat 9 plateb k 8 fakturám?");
    expect(commitTitle(1, 1)).toBe("Zaúčtovat 1 platbu k 1 faktuře?");
    expect(commitSummary({ booked: 2, invoices: 3, unmatched: 1, unrelated: 2 })).toBe(
      "2 platby se zapíšou k 3 fakturám a změní jejich uhrazenou částku. 1 platba bez faktury se uloží jako nespárovaná. 2 řádky „Nesouvisí s fakturami“ se jako platby nezapíšou. Vrátit to lze u jednotlivých plateb tlačítkem „Odpárovat“.",
    );
  });
});
