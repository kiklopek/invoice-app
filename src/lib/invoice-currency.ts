export const INVOICE_CURRENCIES = ["CZK", "EUR", "USD", "GBP", "PLN", "CHF", "HUF", "SEK", "NOK", "DKK", "RON", "JPY", "CAD", "AUD"] as const;
export const ASSUMED_CZK_REASON = "Měna není na dokladu výslovně uvedena. Předpokládá se CZK; potvrďte ji.";

type InvoiceCurrency = typeof INVOICE_CURRENCIES[number];

// Longer names come first, so an OCR spelling of a currency is consumed as
// one token. Generic "$" and "fr" are intentionally omitted: both can name
// several currencies without any indication of which one the invoice uses.
const ALIASES: Array<[InvoiceCurrency, string[]]> = [
  ["CZK", ["českých korun", "korun českých", "české koruny", "koruny české", "česká koruna", "koruna česká", "CZK", "Kč", "Kc"]],
  ["EUR", ["evropských eur", "euro", "eura", "eur", "€"]],
  ["USD", ["amerických dolarů", "americké dolary", "americký dolar", "US dollars", "US dollar", "USD", "US$"]],
  ["GBP", ["britských liber", "britské libry", "britská libra", "liber šterlinků", "libra šterlinků", "pound sterling", "GBP", "£"]],
  ["PLN", ["polských zlotých", "polské zloté", "polský zlotý", "zlotých", "zloté", "zlotý", "PLN", "zł", "zl"]],
  ["CHF", ["švýcarských franků", "švýcarské franky", "švýcarský frank", "Swiss francs", "Swiss franc", "CHF"]],
  ["HUF", ["maďarských forintů", "maďarské forinty", "maďarský forint", "forintů", "forinty", "forint", "HUF"]],
  ["SEK", ["švédských korun", "švédské koruny", "švédská koruna", "Swedish krona", "SEK"]],
  ["NOK", ["norských korun", "norské koruny", "norská koruna", "Norwegian krone", "NOK"]],
  ["DKK", ["dánských korun", "dánské koruny", "dánská koruna", "Danish krone", "DKK"]],
  ["RON", ["rumunských lei", "rumunské lei", "rumunský leu", "Romanian leu", "RON"]],
  ["JPY", ["japonských jenů", "japonské jeny", "japonský jen", "Japanese yen", "JPY"]],
  ["CAD", ["kanadských dolarů", "kanadské dolary", "kanadský dolar", "Canadian dollars", "Canadian dollar", "CAD", "CA$", "C$"]],
  ["AUD", ["australských dolarů", "australské dolary", "australský dolar", "Australian dollars", "Australian dollar", "AUD", "AU$", "A$"]],
];

function normalize(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const aliasMap = new Map(ALIASES.flatMap(([code, names]) => names.map(name => [normalize(name), code] as const)));
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizedAliases = [...aliasMap.keys()].sort((a, b) => b.length - a.length);
// Only letters bound a currency name. Digits may touch it: invoices print
// "£1,200.00", "€1 234", "1 234,50€" and "CHF1'234.50" as often as with a
// space, and a digit next to "Kč" never makes it a different word.
const currencyPattern = new RegExp(`(?<!\\p{L})(?:${normalizedAliases.map(name => escapeRegex(name).replace(/ /g, "\\s+")).join("|")})(?!\\p{L})`, "giu");
// "US$", "CA$", "C$", "AU$" and "A$" name one currency; a bare "$" does not.
const BARE_DOLLAR = /(?<!\p{L})\$/u;
const PREFIXED_DOLLAR = /(?<!\p{L})(?:US|CA|AU|C|A)\$/giu;

/** Currencies a bare "$" on the document can stand for, most common first. */
export const DOLLAR_CURRENCIES = ["USD", "CAD", "AUD"] as const satisfies readonly InvoiceCurrency[];

export function hasBareDollarSign(text: string) {
  return BARE_DOLLAR.test(text.replace(PREFIXED_DOLLAR, ""));
}

export function normalizeInvoiceCurrency(value: string | null | undefined): InvoiceCurrency | null {
  return aliasMap.get(normalize(value ?? "")) ?? null;
}

export function currencyMentions(text: string): InvoiceCurrency[] {
  const normalized = normalize(text);
  return [...normalized.matchAll(currencyPattern)]
    .map(match => aliasMap.get(match[0].replace(/\s+/g, " ")))
    .filter((value): value is InvoiceCurrency => Boolean(value));
}

export function unambiguousCurrency(text: string): InvoiceCurrency | null {
  const found = [...new Set(currencyMentions(text))];
  return found.length === 1 ? found[0] : null;
}

// Recovery from a document row is only for uncertain reading quality. A
// decision about conflicting or unsupported currencies must not be reversed
// just because one of the rows happens to contain a familiar symbol.
const EVIDENCE_RECOVERY_REASONS = new Set([
  "Zdrojový text má nízkou OCR jistotu.",
  "Hodnota nemá dohledatelný zdrojový řádek v dokumentu.",
  "Měna byla načtena z řádku částky. Potvrďte ji podle dokladu.",
]);

export function allowsCurrencyEvidencePrefill(decision?: { status: string; reasons: string[] }) {
  return !decision || decision.status === "verified"
    || decision.reasons.every(reason => EVIDENCE_RECOVERY_REASONS.has(reason));
}
