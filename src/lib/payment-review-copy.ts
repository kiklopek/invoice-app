// Jeden slovník pro párování plateb (kontrola výpisu, Platby, archiv).
//
// Dřív měla jedna akce tři slovesa („Uložit kontrolu a potvrdit import“,
// „Zaúčtovat“, „Potvrdit“) a návrat čtyři („Změnit přiřazení“, „Uvolnit“,
// „Vrátit mezi platby“ …). Uživatel, který se v účetnictví nevyzná, pak
// nepozná, že jde o totéž. Texty proto žijí tady a obrazovky je jen
// skládají; zkratky („VS“, „GPC“) se uživateli nevypisují.
import { countLabel } from "@/lib/czech-plural";

export const PAYMENT_FORMS = ["platba", "platby", "plateb"] as const;
export const PAYMENT_FORMS_ACCUSATIVE = ["platbu", "platby", "plateb"] as const;
export const INVOICE_FORMS = ["faktura", "faktury", "faktur"] as const;
export const INVOICE_FORMS_DATIVE = ["faktuře", "fakturám", "fakturám"] as const;

export const REVIEW_COPY = {
  // Akce (všude stejná slovesa)
  book: "Zaúčtovat",
  unbook: "Odpárovat",
  unbookLabel: "Odpárovat platbu a přiřadit ji jinak",
  notInvoice: "Nesouvisí s fakturami",
  backToPayments: "Vrátit mezi platby",
  acceptOne: "Ano, je to tato faktura",
  acceptMany: "Ano, jsou to tyto faktury",
  chooseOther: "Vybrat jinou fakturu",
  chooseInvoice: "Vybrat fakturu",
  leaveUnmatched: "Nechat nespárovanou",
  closePicker: "Hotovo",
  details: "Podrobnosti platby",

  // Pojmy
  variableSymbol: "variabilní symbol",
  variableSymbolShort: "Var. symbol",
  found: "Co jsme našli",
  noInvoiceFound: "Nenašli jsme fakturu, ke které platba patří.",
  statementFile: "Výpis z banky (soubor GPC nebo CSV)",

  // Souhrn
  bucketDone: "Hotovo",
  bucketNeedsAnswer: "Potřebuje vaši odpověď",
  bucketNotInvoice: "Nesouvisí s fakturami",
  bucketDoneHint: "Zaúčtováno nebo připraveno k zaúčtování.",
  bucketNeedsAnswerHint: "Potvrďte návrh nebo vyberte fakturu.",
  bucketNotInvoiceHint: "Odchozí platby, vlastní převody a řádky, které nejsou platbou.",
  allAnswered: "Vše je vyřešeno – můžete zaúčtovat.",
} as const;

export function paymentCount(count: number) {
  return countLabel(count, PAYMENT_FORMS);
}

/** „Zaúčtovat 9 plateb“ / „Zaúčtovat 1 platbu“. */
export function bookButtonLabel(count: number) {
  return count > 0 ? `${REVIEW_COPY.book} ${countLabel(count, PAYMENT_FORMS_ACCUSATIVE)}` : REVIEW_COPY.book;
}

/** „Zbývá odpovědět: 3“ s doplňující větou, co se s nimi stane. */
export function remainingNotice(count: number) {
  if (count === 0) return REVIEW_COPY.allAnswered;
  return `${count === 1 ? "1 platba zůstane nespárovaná" : `${paymentCount(count)} ${count <= 4 ? "zůstanou nespárované" : "zůstane nespárovaných"}`}, dořešíte ${count === 1 ? "ji" : "je"} později v Platbách.`;
}

/** Shrnutí dopadu do potvrzovacího dialogu, česky správně. */
export function commitSummary({ booked, invoices, unmatched, unrelated }: { booked: number; invoices: number; unmatched: number; unrelated: number }) {
  const parts: string[] = [];
  if (booked) parts.push(`${countLabel(booked, PAYMENT_FORMS)} se ${booked === 1 ? "zapíše" : booked <= 4 ? "zapíšou" : "zapíše"} k ${countLabel(invoices, INVOICE_FORMS_DATIVE)} a změní ${invoices === 1 ? "její" : "jejich"} uhrazenou částku.`);
  if (unmatched) parts.push(`${countLabel(unmatched, PAYMENT_FORMS)} bez faktury se ${unmatched === 1 ? "uloží jako nespárovaná" : "uloží jako nespárované"}.`);
  if (unrelated) parts.push(`${countLabel(unrelated, ["řádek", "řádky", "řádků"])} „${REVIEW_COPY.notInvoice}“ se jako ${unrelated >= 2 && unrelated <= 4 ? "platby nezapíšou" : "platba nezapíše"}.`);
  parts.push("Vrátit to lze u jednotlivých plateb tlačítkem „Odpárovat“.");
  return parts.join(" ");
}

export function commitTitle(booked: number, invoices: number) {
  return booked > 0
    ? `Zaúčtovat ${countLabel(booked, PAYMENT_FORMS_ACCUSATIVE)} k ${countLabel(invoices, INVOICE_FORMS_DATIVE)}?`
    : "Uložit platby bez zaúčtování k fakturám?";
}
