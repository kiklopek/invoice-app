export const OCR_VOCABULARY_VERSION = "2026-09-30.1";

export type OcrConcept =
  | "counterparty"
  | "issuer"
  | "ico"
  | "dic"
  | "invoice_number"
  | "variable_symbol"
  | "issue_date"
  | "due_date"
  | "taxable_date"
  | "net_amount"
  | "vat"
  | "gross_amount"
  | "paid_amount"
  | "remaining_amount"
  | "negative_party_context";

// Canonical accounting vocabulary. Terms are stored without diacritics and
// punctuation because OCR frequently loses both. Keep short, ambiguous labels
// (VS, IC, ID) in the dictionary, but match them exactly -- fuzzy matching is
// deliberately limited to longer phrases.
export const OCR_TERMS: Record<OcrConcept, readonly string[]> = {
  counterparty: ["odberatel", "zakaznik", "kupujici", "objednatel", "klient", "prijemce faktury", "bill to", "sold to", "invoice to", "customer", "buyer", "purchaser"],
  issuer: ["dodavatel", "vystavitel", "prodavajici", "zhotovitel", "supplier", "seller", "vendor", "issuer"],
  ico: ["ico", "ic", "company id", "company number", "registration number"],
  dic: ["dic", "ic dph", "vat id", "vat number", "tax id"],
  invoice_number: ["cislo faktury", "cislo dokladu", "faktura c", "danovy doklad c", "invoice number", "invoice no", "document number"],
  variable_symbol: ["variabilni symbol", "variabilny symbol", "var symbol", "vs", "payment reference"],
  issue_date: ["datum vystaveni", "datum vystavenia", "den vystaveni", "vystaveno dne", "vystavene dna", "issue date", "invoice date", "date of issue"],
  due_date: ["datum splatnosti", "splatnost", "splatne dna", "uhradte do", "due date", "payment due", "maturity date"],
  taxable_date: ["duzp", "datum uskutecneni zdanitelneho plneni", "datum dodania", "taxable supply date"],
  net_amount: ["zaklad dane", "zaklad dph", "celkem bez dph", "celkom bez dph", "cena bez dph", "subtotal", "net amount", "tax base", "medzisucet"],
  vat: ["dph", "dan", "sazba dph", "sadzba dph", "vat", "tax amount", "tax rate"],
  gross_amount: ["celkem k uhrade", "celkom k uhrade", "castka k uhrade", "suma na uhradu", "k uhrade", "celkem s dph", "celkom s dph", "grand total", "total due", "amount due", "balance due"],
  paid_amount: ["uhrazeno", "uhradene", "zaplaceno", "zaplatene", "zaloha", "prepayment", "paid"],
  remaining_amount: ["zbyva uhradit", "zostava uhradit", "nedoplatek", "balance due", "remaining amount"],
  negative_party_context: ["dodavatel", "vystavitel", "vystavil", "prodavajici", "kontakt", "bankovni spojeni", "bankove spojenie", "prijemce zbozi", "ship to"],
};

export function normalizeOcrKeyword(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs")
    .replace(/[„“”"'`:;,.#()[\]{}\\/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const old = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = old;
    }
  }
  return previous[right.length];
}

function toleratedDistance(term: string) {
  if (term.length < 5) return 0;
  if (term.length >= 12) return 2;
  return 1;
}

export type OcrConceptMatch = {
  concept: OcrConcept;
  term: string;
  matched: string;
  exact: boolean;
  score: number;
};

export function matchOcrConcept(value: string, concept: OcrConcept): OcrConceptMatch | null {
  const normalized = normalizeOcrKeyword(value);
  if (!normalized) return null;
  const words = normalized.split(" ");
  let best: OcrConceptMatch | null = null;

  for (const rawTerm of OCR_TERMS[concept]) {
    const term = normalizeOcrKeyword(rawTerm);
    if (normalized === term || normalized.includes(` ${term} `) || normalized.startsWith(`${term} `) || normalized.endsWith(` ${term}`)) {
      const match = { concept, term: rawTerm, matched: term, exact: true, score: 1 } satisfies OcrConceptMatch;
      if (!best || match.score > best.score) best = match;
      continue;
    }
    const termWords = term.split(" ");
    const tolerance = toleratedDistance(term);
    if (!tolerance) continue;
    for (let index = 0; index <= words.length - termWords.length; index += 1) {
      const candidate = words.slice(index, index + termWords.length).join(" ");
      const distance = editDistance(candidate, term);
      if (distance <= tolerance) {
        const score = 1 - distance / Math.max(candidate.length, term.length);
        const match = { concept, term: rawTerm, matched: candidate, exact: false, score } satisfies OcrConceptMatch;
        if (!best || match.score > best.score) best = match;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Poškozená textová vrstva PDF: chybějící znaky s háčkem
//
// Některé generátory PDF vkládají písmo jen v kódování Windows-1252. Znaky,
// které v něm nejsou -- č, ď, ě, ň, ř, ť, ů -- se do textové vrstvy vůbec
// nedostanou a na jejich místě zůstane mezera: "ODB RATEL", "I O: 26229854",
// "DI : CZ26229854", "da ový doklad", "K úhrad :". Na obrazovce dokument
// vypadá v pořádku, ale žádný popisek se nenajde a parser vrátí prázdnou
// sekci odběratele.
//
// Poškození je deterministické: z tištěné podoby popisku přesně víme, jak
// bude vypadat po ztrátě znaků. Proto tu držíme popisky v tištěné podobě s
// diakritikou a poškozenou variantu z nich odvozujeme -- žádné ruční regexy
// pro jednotlivé případy. Opravují se jen POPISKY; hodnoty (jména, adresy)
// opravit nelze, a proto parser takový dokument hlásí jako poškozený.
const DROPPED_GLYPH_CLASS = "[čďěňřťůČĎĚŇŘŤŮ]";

// Jak popisek vypadá v poškozené textové vrstvě (znak -> mezera).
export function damagedLabelForm(printed: string) {
  return printed.replace(new RegExp(DROPPED_GLYPH_CLASS, "g"), " ");
}

export const OCR_PRINTED_LABELS: readonly string[] = [
  // Delší popisky první -- "ič dph" se musí opravit dřív než samotné "ič".
  "datum uskutečnění zdanitelného plnění",
  "celkem k úhradě", "částka k úhradě", "opravný daňový doklad", "příjemce faktury",
  "číslo faktury", "číslo dokladu", "daňový doklad", "základ daně", "k úhradě",
  "odběratel", "ič dph", "ičo", "dič", "ič",
];

type GlyphGapRepair = { pattern: RegExp; printed: string };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildGlyphGapRepairs(): GlyphGapRepair[] {
  return OCR_PRINTED_LABELS.flatMap(printed => {
    if (!new RegExp(DROPPED_GLYPH_CLASS).test(printed)) return [];
    const damaged = damagedLabelForm(printed).replace(/\s+/g, " ").trim();
    const letters = damaged.replace(/[^\p{L}]/gu, "").length;
    if (letters < 1) return [];
    const endsWithGap = new RegExp(`${DROPPED_GLYPH_CLASS}$`).test(printed);
    const body = damaged.split(" ").map(escapeRegExp).join("[ \\t]+");
    // Krátké popisky ("I O", "DI", "I") jsou samy o sobě běžná písmena, takže
    // se přijmou jen v podobě popisku -- s dvojtečkou, u jednopísmenného
    // "IČ" navíc s číslem za ní.
    const tail = letters === 1
      ? "(?=[ \\t]*:[ \\t]*\\d{6})"
      : letters < 4
        ? "(?=[ \\t]*:)"
        : endsWithGap ? "(?=[\\s:.]|$)" : "(?![\\p{L}\\d])";
    return [{ pattern: new RegExp(`(?<![\\p{L}\\d])${body}${tail}`, "giu"), printed }];
  });
}

const GLYPH_GAP_REPAIRS = buildGlyphGapRepairs();

function matchCase(template: string, printed: string) {
  const letters = template.replace(/[^\p{L}]/gu, "");
  if (letters && letters === letters.toUpperCase()) return printed.toUpperCase();
  if (/^\p{Lu}/u.test(template)) return printed.charAt(0).toUpperCase() + printed.slice(1);
  return printed;
}

// Vrátí text s opravenými popisky a seznam oprav. Prázdný seznam znamená, že
// textová vrstva nenese znaky poškozeného písma.
export function repairDroppedGlyphLabels(text: string): { text: string; repaired: string[] } {
  const repaired: string[] = [];
  let result = text;
  for (const repair of GLYPH_GAP_REPAIRS) {
    result = result.replace(repair.pattern, match => {
      repaired.push(match);
      return matchCase(match, repair.printed);
    });
  }
  return { text: result, repaired };
}

export function hasDroppedGlyphLabels(text: string) {
  return repairDroppedGlyphLabels(text).repaired.length > 0;
}

export function conceptAlternation(concept: OcrConcept) {
  return OCR_TERMS[concept]
    .map(term => normalizeOcrKeyword(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"))
    .join("|");
}

const OCR_CONCEPTS = Object.keys(OCR_TERMS) as OcrConcept[];
const GENERIC_DOCUMENT_LABELS = new Set([
  "adresa", "ulice", "mesto", "psc", "telefon", "mobil", "email", "e mail",
  "iban", "swift", "bic", "cislo uctu", "bankovni spojeni", "bankove spojenie",
  "poznamka", "objednavka", "zpusob platby", "forma uhrady",
]);

export type OcrKeywordSuggestion = { normalized_label: string; example_label: string };

export function findUnknownAccountingLabels(text: string): OcrKeywordSuggestion[] {
  const suggestions = new Map<string, OcrKeywordSuggestion>();
  for (const line of text.split(/\r?\n/)) {
    const label = line.match(/^\s*([^:\n]{3,48})\s*:\s*\S/)?.[1]?.trim();
    if (!label || /\d/.test(label)) continue;
    const normalized = normalizeOcrKeyword(label);
    if (!normalized || GENERIC_DOCUMENT_LABELS.has(normalized)) continue;
    if (OCR_CONCEPTS.some(concept => matchOcrConcept(normalized, concept))) continue;
    suggestions.set(normalized, { normalized_label: normalized.slice(0, 80), example_label: label.slice(0, 80) });
  }
  return [...suggestions.values()].slice(0, 12);
}
