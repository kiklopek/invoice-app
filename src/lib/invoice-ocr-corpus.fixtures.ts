// Korpus skutečných faktur pro měření OCR, přepsaný do podoby, v jaké ho
// vrací textová vrstva PDF (pořadí řádků podle souřadnic, popisky a hodnoty
// často pod sebou). Rozvržení, částky, data a čísla dokladů odpovídají
// originálům od testera; názvy firem, IČO/DIČ, adresy a kontakty jsou
// anonymizované (IČO s platnou kontrolní číslicí, DIČ = CZ + IČO).
//
// Každý dokument nese i očekávané hodnoty. Test nad korpusem
// (invoice-ocr-corpus.test.ts) vyžaduje u každého pole buď přesnou hodnotu,
// nebo viditelný stav "k ověření" -- nikdy ne špatnou hodnotu jako ověřenou.

import type { InvoiceOcrOrganization, OcrDocumentKind, OcrFieldName } from "./invoice-ocr";

export type CorpusDocument = {
  id: string;
  description: string;
  organization: InvoiceOcrOrganization;
  text: string;
  expected: Partial<Record<OcrFieldName, string | number>>;
  expectedKind: OcrDocumentKind;
  // Pole, u kterých musí lokální parser vrátit přesnou hodnotu (ne jen
  // "k ověření"). Ostatní pole z `expected` smí skončit jako review/missing.
  mustRead: OcrFieldName[];
};

// Textová vrstva některých PDF ztrácí znaky, které nejsou ve Windows-1250/1252
// kódování písma vloženého do PDF: č, ď, ě, ň, ř, ť, ů. Na jejich místě zůstane
// mezera ("ODB RATEL", "I O", "DI :", "da ový doklad", "Kate ina").
export function dropCaronGlyphs(text: string) {
  return text.replace(/[čďěňřťůČĎĚŇŘŤŮ]/g, " ");
}

// (A) Zálohová faktura 426198. Popisky a hodnoty v hlavičce jsou v PDF dva
// samostatné sloupce, takže je textová vrstva vrací pod sebou. Nadpis je
// proložený mezerami a leží až na konci streamu.
const advanceInvoiceText = `Dodavatel:
Martin Kolar
Lipová 12
500 03 Hradec Králové
IČ: 27182819
DIČ: CZ7901011239
Fyzická osoba zapsaná v živnostenském rejstříku.
Odběratel:
KZ - STAVBY plus s.r.o.
Luční 5
500 02 Hradec Králové
DIČ: CZ31415920 IČO : 31415920
Číslo faktury:
Datum vystavení:
Datum splatnosti:
Forma úhrady:
Konstantní symbol:
426198
02.09.2026
16.09.2026
Převodem
0308
Bankovní spojení:
Fio banka, a.s.
Číslo účtu: 2400123456/2010
Fakturujeme Vám zálohu na nájem kanceláře za 10/2026.
Nejedná se o daňový doklad dle Zákona o DPH č. 302/2008 Sb.
Označení dodávky Množství J.cena Celkem
Záloha na nájem 10/2026 1 3 370,00 3 370,00
CELKEM : 3 370,00 Kč
Vystavil: Martin Kolar
Z Á L O H O V Á F A K T U R A`;

// (B) Samofakturace TIMBER & PULP 1443260157: doklad vystavil zákazník
// (odběratel) jménem dodavatele. Kontakt "Fakturu vystavil" patří odběrateli,
// ne naší firmě -- a firma, která má platit, je pořád odběratel.
const selfBilledText = `FAKTURA - daňový doklad č. 1443260157
VYSTAVENO ZÁKAZNÍKEM
Dodavatel:
M. Kolar, s.r.o.
Polní 7
549 01 Nové Město nad Metují
IČO: 16180330
DIČ: CZ16180330
ODBĚRATEL: IČO: 46692011
DIČ: CZ46692011
TIMBER & PULP a.s.
Dubová č.p. 38
664 91 Ivančice
Datum vystavení: 15.9.2026
Datum usk. zdan. plnění: 15.9.2026
Datum splatnosti: 23.9.2026
Forma úhrady: převodem
Konstantní symbol: 0008
Položka Množství Cena bez DPH DPH %
Dřevní hmota - kulatina 42,3 m3 101 735,70 21
Celkem bez DPH: 101 735,70 CZK
DPH 21 %: 21 364,50 CZK
K úhradě: 123 100,20 CZK
Fakturu vystavil: Kateřina Nováková
E-mail: katerina.novakova@timber-pulp.cz
Tel.: +420 546 123 456`;

const advanceOrganization = { name: "Martin Kolar", ico: "27182819", dic: "CZ7901011239" };
const selfBilledOrganization = { name: "M. Kolar, s.r.o.", ico: "16180330", dic: "CZ16180330" };

const selfBilledExpected = {
  invoice_number: "1443260157",
  counterparty_name: "TIMBER & PULP a.s.",
  counterparty_ico: "46692011",
  counterparty_dic: "CZ46692011",
  counterparty_email: "katerina.novakova@timber-pulp.cz",
  variable_symbol: "",
  issue_date: "2026-09-15",
  due_date: "2026-09-23",
  amount_without_vat: 101735.7,
  vat_rate: 21,
  amount: 123100.2,
  currency: "CZK",
} satisfies CorpusDocument["expected"];

const selfBilledMustRead: OcrFieldName[] = [
  "invoice_number", "counterparty_name", "counterparty_ico", "counterparty_dic",
  "counterparty_email", "issue_date", "due_date", "amount_without_vat", "vat_rate", "amount", "currency",
];

export const OCR_CORPUS: CorpusDocument[] = [
  {
    id: "advance-426198",
    description: "zálohová faktura 426198 (proložený nadpis, popisky a hodnoty pod sebou, bez VS)",
    organization: advanceOrganization,
    text: advanceInvoiceText,
    expected: {
      invoice_number: "426198",
      counterparty_name: "KZ - STAVBY plus s.r.o.",
      counterparty_ico: "31415920",
      counterparty_dic: "CZ31415920",
      variable_symbol: "",
      issue_date: "2026-09-02",
      due_date: "2026-09-16",
      amount: 3370,
      amount_without_vat: 3370,
      vat_rate: 0,
      currency: "CZK",
    },
    expectedKind: "proforma",
    mustRead: ["invoice_number", "counterparty_name", "counterparty_ico", "counterparty_dic", "issue_date", "due_date", "amount", "currency"],
  },
  {
    id: "self-billed-1443260157",
    description: "samofakturace TIMBER & PULP 1443260157, neporušený text",
    organization: selfBilledOrganization,
    text: selfBilledText,
    expected: selfBilledExpected,
    expectedKind: "issued_invoice",
    mustRead: selfBilledMustRead,
  },
  {
    id: "self-billed-1443260157-dropped-glyphs",
    description: "samofakturace TIMBER & PULP 1443260157, textová vrstva bez č/ě/ř/ň",
    organization: selfBilledOrganization,
    text: dropCaronGlyphs(selfBilledText),
    expected: selfBilledExpected,
    expectedKind: "issued_invoice",
    mustRead: selfBilledMustRead,
  },
];
