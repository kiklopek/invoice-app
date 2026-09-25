import "server-only";

import { boundedText, deriveOcrFieldDecisions, type InvoiceOcrOrganization, type InvoiceOcrResult, type OcrFieldName, type OcrFieldSource } from "@/lib/invoice-ocr";
import { OCR_VOCABULARY_VERSION } from "@/lib/invoice-ocr-vocabulary";
import { grossFromNet, netFromGross, roundMoney, vatAmountsMatch } from "@/lib/vat";
import type { InvoiceInput } from "@/types/invoice";

// This is the ONE place in the app where a document -- and everything on
// it: counterparty name, e-mail, IČO, amounts, our own bank account -- is
// sent to a third party. Opt-in only (OCR_PROVIDER=gemini), and every
// result carries an explicit warning saying so, because a person confirming
// this import has a right to know the document left the company before
// they click "uložit". Not something to flip on for real customer documents
// without reading Google's Gemini API data-processing terms for the account
// in use.
export class GeminiOcrError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

// Called directly against Google's Generative Language API (no OpenRouter
// middleman -- one fewer party in the data-processing chain, and Gemini has
// a genuine free tier for this model, unlike routing through OpenRouter
// where free-tier models don't support PDF/file input at all).
// gemini-3.5-flash-lite, not a newer "-latest"/preview alias: verified
// 2026-09-20 against a real account -- the newest preview-tier flash models
// (gemini-3.6-flash, gemini-flash-latest) intermittently returned 503 "high
// demand" and even a bare 400 on the exact same request that succeeded a
// moment later, while this one answered correctly and consistently. Google
// also periodically cuts off older model versions for new API keys (this
// project already hit that with gemini-2.5-flash and gemini-2.5-flash-lite,
// both 404 "no longer available to new users") -- re-verify against
// GET /v1beta/models before assuming this slug still works long-term.
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
export const GEMINI_OCR_DISCLOSURE =
  "Údaje byly doplněny pomocí AI (Google Gemini) za účelem maximální přesnosti. Než fakturu uložíte, zkontrolujte všechny údaje.";

const EXTRACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    invoice_number: { type: "STRING" },
    counterparty_name: { type: "STRING" },
    counterparty_ico: { type: "STRING" },
    counterparty_dic: { type: "STRING" },
    counterparty_email: {
      type: "STRING",
      description: "Jen e-mail explicitně uvedený v sekci ODBĚRATELE. Nikdy kontaktní e-mail vystavitele/účetní v patičce dokumentu.",
    },
    variable_symbol: {
      type: "STRING",
      description: "Jen hodnota explicitně popsaná jako \"Variabilní symbol\"/\"VS\" na dokumentu. Nikdy konstantní symbol (KS), specifický symbol (SS) ani číslo faktury.",
    },
    amount_without_vat: {
      type: "NUMBER",
      description: "Základ daně bez DPH. U více sazeb/kategorií DPH najednou součet přes všechny (řádek/sloupec \"Celkem\"), nikdy hodnota jedné sazby a nikdy sloupec \"Celkem s DPH\".",
    },
    vat_rate: { type: "NUMBER", description: "Sazba DPH v procentech (21, 12 nebo 0 v ČR)." },
    amount: { type: "NUMBER", description: "Celková částka k úhradě, s DPH." },
    currency: { type: "STRING", description: "ISO kód měny (CZK, EUR, USD), ne symbol jako Kč nebo €." },
    issue_date: { type: "STRING", description: "YYYY-MM-DD" },
    due_date: { type: "STRING", description: "YYYY-MM-DD" },
    evidence: {
      type: "OBJECT",
      description: "Důkaz pro každé vrácené pole. Klíč odpovídá názvu pole.",
      properties: Object.fromEntries([
        "invoice_number", "counterparty_name", "counterparty_ico", "counterparty_dic", "counterparty_email",
        "variable_symbol", "amount_without_vat", "vat_rate", "amount", "currency", "issue_date", "due_date",
      ].map(field => [field, {
        type: "OBJECT",
        properties: {
          page: { type: "INTEGER" },
          text: { type: "STRING" },
          party_role: { type: "STRING", enum: ["counterparty", "issuer", "document", "unknown"] },
        },
        required: ["page", "text", "party_role"],
      }])),
    },
  },
  required: ["invoice_number", "amount_without_vat", "vat_rate", "amount"],
};

// Rewritten 2026-09-20 after two real extraction errors surfaced in
// hybrid-mode testing against real invoices: (1) Gemini invented a
// variable_symbol equal to the invoice number on a document that had no
// variable symbol at all, and (2) Gemini picked the wrong number out of a
// multi-rate VAT recap table for amount_without_vat. Both are now called
// out explicitly below, in Czech-accounting-specific terms, not just
// "don't invent values" in the abstract -- the model needs to know WHICH
// look-alike fields/values are commonly confused for Czech invoices
// specifically, not just that mistakes are possible in general.
const PROMPT = `Jsi zkušený český účetní specializovaný na daňové doklady (faktury) a DPH
podle českých pravidel. Přesnost je tvoje profesní povinnost -- špatně
přečtené číslo má reálné finanční důsledky: nesprávná částka znamená
chybnou platbu, špatný variabilní symbol znamená, že se platba nespáruje
s fakturou automaticky, záměna odběratele a dodavatele znamená, že
upomínka půjde na špatnou firmu. Proto: hodnotu vrať POUZE pokud je na
dokumentu doslovně napsaná. Nikdy nic nepočítej, neodvozuj z kontextu, ani
nedoplňuj podle "obvyklé konvence" -- to, co se běžně dělá jinde, není
totéž jako to, co je napsané na TÉTO faktuře. Prázdné pole je vždy
bezpečnější než hádaná hodnota, protože prázdné pole si člověk při
kontrole všimne a doplní, zatímco tiše špatně uhodnutá hodnota může projít
bez povšimnutí.

Specifika českého účetnictví, která musíš znát a nezaměňovat:

- Variabilní symbol (VS), konstantní symbol (KS) a specifický symbol (SS)
  jsou TŘI RŮZNÁ pole, ne synonyma. Pro variable_symbol platí VÝHRADNĚ
  hodnota explicitně popsaná jako "Variabilní symbol" nebo "VS" -- nikdy KS,
  nikdy SS, nikdy číslo faktury, i kdyby se číselně shodovalo. VS se používá
  k AUTOMATICKÉMU párování plateb z bankovního výpisu, takže vymyšlená nebo
  záměněná hodnota může způsobit, že se reálná platba nespáruje se správnou
  fakturou. Pokud popisek "variabilní symbol"/"VS" chybí, vrať prázdný
  řetězec.

- Sazby DPH v ČR jsou 21 % (základní), 12 % (snížená) a 0 %. Nezaměňuj
  ale nulovou sazbu s kategoriemi "Osvobozeno od DPH" a "Není předmětem
  DPH" -- to jsou z právního hlediska různé věci, ale v rekapitulační
  tabulce se často zobrazují vedle sebe jako samostatné sloupce s nulovou
  částkou. Když faktura kombinuje víc sazeb/kategorií najednou (běžné u
  faktur za nájem s DPH i položkami mimo předmět daně), amount_without_vat
  je SOUČET základů přes VŠECHNY sazby/kategorie dohromady (řádek/sloupec
  "Celkem" nebo "Základ daně" úplně dole/vpravo v tabulce) -- nikdy hodnota
  z jednoho sazbového sloupce samotného, a nikdy si nespleť sloupec "Celkem
  s DPH" nebo řádek "Daň" se základem daně. Tohle je nejčastější chyba u
  složitějších rekapitulačních tabulek -- dvakrát si to zkontroluj.

- amount (celková částka k úhradě, s DPH): u "K úhradě" nebo "Celkem k
  úhradě"/"Celkem s DPH". Drobný rozdíl v řádu haléřů oproti
  základ×(1+sazba) je u víceřádkových faktur normální (zaokrouhlování
  po řádcích) -- to není chyba, kterou bys měl "opravovat" přepočtem,
  přepiš přesně natištěnou částku.

- IČO má vždy 8 číslic, DIČ právnické osoby je "CZ" + stejných 8 číslic
  jako IČO. OSVČ (fyzická osoba podnikající) nemusí mít DIČ vůbec, pokud
  není plátce DPH -- prázdné DIČ u fyzické osoby není chyba ani chybějící
  údaj, je to očekávaný stav.

- counterparty_* se týká VÝHRADNĚ odběratele (kdo má fakturu zaplatit),
  nikdy dodavatele/vystavitele. Buď obzvlášť opatrný u counterparty_email --
  vrať ho JEN pokud je e-mailová adresa explicitně uvedená v sekci
  odběratele, ne kontaktní e-mail vystavitele/účetní v patičce dokumentu
  (např. "Vystavil: ... Email: ..."), i kdyby to byl jediný e-mail na celé
  faktuře.

- Pro každou neprázdnou hodnotu vrať v objektu evidence doslovný krátký text
  z dokumentu, číslo stránky a party_role. Pokud nedokážeš uvést konkrétní
  důkaz nebo roli, nech příslušnou hodnotu prázdnou. Hodnota z party_role
  "issuer" nikdy nesmí být vrácena jako counterparty_*.

- currency vracej jako ISO kód (CZK, EUR, USD), ne symbol jako "Kč" nebo "€".

Data vracej jako YYYY-MM-DD.`;

type GeminiExtraction = Partial<{
  invoice_number: string;
  counterparty_name: string;
  counterparty_ico: string;
  counterparty_dic: string;
  counterparty_email: string;
  variable_symbol: string;
  amount_without_vat: number;
  vat_rate: number;
  amount: number;
  currency: string;
  issue_date: string;
  due_date: string;
  evidence: Partial<Record<OcrFieldName, { page?: number; text?: string; party_role?: "counterparty" | "issuer" | "document" | "unknown" }>>;
}>;

function isIsoDateLike(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// One retry for a transient hiccup (rate limit, momentary 5xx) -- never for
// "not_configured" (a missing key retrying won't fix) or "invalid_key_format"
// (a malformed key won't fix itself on retry either).
const MAX_ATTEMPTS = 2;
const NON_RETRYABLE_CODES = new Set(["not_configured", "invalid_key_format"]);

// Google AI Studio keys are "AIzaSy" + 33 more characters (39 total). A
// configured value that doesn't match this shape is almost certainly a
// stale/placeholder value (e.g. copied from a different credential type),
// not a real Gemini key -- calling Google's API with it would otherwise
// fail as a generic 400/403, indistinguishable from a real auth problem or
// a transient error. Catching the wrong shape up front turns a confusing
// runtime failure into a clear, specific configuration error.
const GEMINI_API_KEY_SHAPE = /^AIzaSy[A-Za-z0-9_-]{33}$/;

async function callGemini(bytes: Uint8Array, mime: string): Promise<{ data: GeminiExtraction; model: string; responseId: string | null }> {
  let lastError: GeminiOcrError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callGeminiOnce(bytes, mime);
    } catch (cause) {
      if (!(cause instanceof GeminiOcrError) || NON_RETRYABLE_CODES.has(cause.code)) throw cause;
      lastError = cause;
      console.error(`[invoice-ocr-gemini] pokus ${attempt}/${MAX_ATTEMPTS} selhal (${cause.code}), ${attempt < MAX_ATTEMPTS ? "zkouším znovu" : "vzdávám se"}`);
      if (attempt < MAX_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError ?? new GeminiOcrError("AI OCR selhalo bez konkrétní chyby.", "api_error");
}

async function callGeminiOnce(bytes: Uint8Array, mime: string): Promise<{ data: GeminiExtraction; model: string; responseId: string | null }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new GeminiOcrError("AI OCR (Gemini) není nakonfigurováno.", "not_configured");
  if (!GEMINI_API_KEY_SHAPE.test(apiKey)) {
    throw new GeminiOcrError(
      "GEMINI_API_KEY nemá formát platného klíče Google AI Studio (očekáváno \"AIzaSy...\", 39 znaků). Zkontrolujte konfiguraci.",
      "invalid_key_format",
    );
  }

  const base64 = Buffer.from(bytes).toString("base64");
  const requestBody = JSON.stringify({
    contents: [{
      role: "user",
      // The REST JSON mapping for this API is camelCase (inlineData/
      // mimeType), not the snake_case used by OpenAI-style APIs --
      // inline_data/mime_type here silently fails with a generic 400
      // "invalid argument" instead of a helpful field-name error.
      parts: [
        { text: PROMPT },
        { inlineData: { mimeType: mime, data: base64 } },
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: EXTRACTION_SCHEMA,
    },
  });

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: requestBody,
        // Short per-attempt budget on purpose: the extract route has a hard
        // maxDuration of 60s total, and up to MAX_ATTEMPTS retries share that
        // one budget.
        signal: AbortSignal.timeout(25_000),
      },
    );
  } catch {
    // AbortSignal.timeout rejects the fetch itself (never produces a
    // response), so it lands here, not in the !response.ok branch below.
    throw new GeminiOcrError("Gemini neodpovědělo včas.", "timeout");
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[invoice-ocr-gemini] API error", { status: response.status, body: body.slice(0, 1000) });
    throw new GeminiOcrError(`Gemini API vrátilo chybu (${response.status}).`, response.status === 429 ? "rate_limited" : "api_error");
  }

  const payload = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    responseId?: string;
    modelVersion?: string;
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new GeminiOcrError("Gemini nevrátilo žádný text.", "empty_response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiOcrError("Odpověď AI nebyla platný JSON.", "invalid_json");
  }
  if (typeof parsed !== "object" || parsed === null) throw new GeminiOcrError("Odpověď AI nebyla platný objekt.", "invalid_json");
  return { data: parsed as GeminiExtraction, model: payload.modelVersion ?? GEMINI_MODEL, responseId: payload.responseId ?? null };
}

export async function extractInvoiceWithGemini({
  bytes,
  mime,
  fileUrl,
  organization,
}: {
  bytes: Uint8Array;
  mime: string;
  fileUrl: string;
  organization: InvoiceOcrOrganization;
}): Promise<InvoiceOcrResult> {
  const called = await callGemini(bytes, mime);
  const { model, responseId } = called;
  let data = called.data;

  const amount = typeof data.amount === "number" && Number.isFinite(data.amount) ? roundMoney(Math.max(0, data.amount)) : 0;
  const amountWithoutVat = typeof data.amount_without_vat === "number" && Number.isFinite(data.amount_without_vat) ? roundMoney(Math.max(0, data.amount_without_vat)) : 0;
  const vatRate = typeof data.vat_rate === "number" && Number.isFinite(data.vat_rate) ? roundMoney(Math.max(0, Math.min(100, data.vat_rate))) : 0;

  const warnings: string[] = [GEMINI_OCR_DISCLOSURE];
  // Same class of bug fixed in the local parser's e-mail extraction: nothing
  // stops an AI from reading the SUPPLIER section as the customer on an
  // unfamiliar layout. Guard the one field with a cheap, certain check --
  // our own IČO can never legitimately be the counterparty.
  const ownIco = organization.ico?.replace(/[^0-9]/g, "") || null;
  const ownDic = organization.dic?.replace(/[\s-]/g, "").toUpperCase() || null;
  if (ownIco && data.counterparty_ico?.replace(/[^0-9]/g, "") === ownIco) {
    data = { ...data, counterparty_ico: "", counterparty_name: "", counterparty_email: "" };
    warnings.push("AI rozpoznala jako odběratele vaši vlastní firmu -- údaje byly vynechány, doplňte je ručně.");
  }
  if (ownDic && data.counterparty_dic?.replace(/[\s-]/g, "").toUpperCase() === ownDic) {
    data = { ...data, counterparty_dic: "" };
    warnings.push("AI přiřadila odběrateli DIČ vaší vlastní firmy -- DIČ bylo vynecháno, zkontrolujte jej ručně.");
  }
  // Same money-safety posture as the local parser: an AI-reported net/rate
  // that doesn't actually reconcile with the AI-reported gross is exactly
  // the kind of thing that must surface as a warning, not get silently
  // trusted -- an LLM can misread a dense number table same as a regex can.
  if (amount && amountWithoutVat && !vatAmountsMatch(amountWithoutVat, vatRate, amount)) {
    warnings.push("Základ, sazba a celková částka od AI si vzájemně neodpovídají. Před uložením ručně zkontrolujte všechny tři hodnoty.");
  }
  if (!data.counterparty_name) warnings.push("AI nerozpoznala jméno odběratele.");
  if (!data.counterparty_ico) warnings.push("AI nerozpoznala IČO odběratele.");
  if (!amount) warnings.push("AI nerozpoznala celkovou částku faktury.");

  const invoice: InvoiceInput = {
    invoice_number: boundedText(data.invoice_number, 100),
    counterparty_name: boundedText(data.counterparty_name, 200),
    counterparty_ico: boundedText(data.counterparty_ico, 20),
    counterparty_dic: boundedText(data.counterparty_dic, 24),
    counterparty_email: boundedText(data.counterparty_email, 254),
    variable_symbol: boundedText(data.variable_symbol, 20),
    amount_without_vat: amountWithoutVat,
    vat_rate: vatRate,
    amount,
    currency: boundedText(data.currency, 3).toUpperCase() || "CZK",
    issue_date: isIsoDateLike(data.issue_date) ? data.issue_date : "",
    due_date: isIsoDateLike(data.due_date) ? data.due_date : "",
    source: "ocr",
    file_url: fileUrl,
    // Same shape the local parser writes, so the existing money-confirmation
    // UI (invoice-form.tsx) and the validate_invoice_money_evidence trigger
    // work identically regardless of which extraction path produced them.
    money_evidence: {
      original_total: amount,
      total_source: amount ? "read" : "derived",
      adjustment: roundMoney(amount - grossFromNet(amountWithoutVat, vatRate)),
      adjustment_reason: "",
      adjustment_confirmed: false,
      initial_paid: 0,
      initial_paid_confirmed: false,
      multi_rate: false,
    },
  };
  if (!amount && amountWithoutVat) invoice.amount = grossFromNet(amountWithoutVat, vatRate);
  else if (amount && !amountWithoutVat) invoice.amount_without_vat = netFromGross(amount, vatRate);

  // No line/bounding-box provenance from an AI text answer -- "ai" is the
  // honest method for that, see the OcrFieldSource comment in invoice-ocr.ts.
  const aiSource = (field: OcrFieldName, value: unknown): OcrFieldSource | undefined => {
    if (value === null || value === undefined || value === "") return undefined;
    const evidence = data.evidence?.[field];
    if (field.startsWith("counterparty_") && evidence?.party_role !== "counterparty") {
      warnings.push(`AI nedoložila pole ${field} důkazem ze sekce odběratele; hodnota vyžaduje ruční kontrolu.`);
      return undefined;
    }
    return {
      page: typeof evidence?.page === "number" && evidence.page > 0 ? Math.floor(evidence.page) : 1,
      line: 0,
      text: boundedText(evidence?.text || String(value), 240),
      method: "ai",
      confidence: evidence?.text ? 0.65 : 0.45,
      bounds: null,
      role: evidence?.party_role ?? "unknown",
    };
  };
  const fieldSources: Partial<Record<OcrFieldName, OcrFieldSource>> = {
    invoice_number: aiSource("invoice_number", data.invoice_number),
    counterparty_name: aiSource("counterparty_name", data.counterparty_name),
    counterparty_ico: aiSource("counterparty_ico", data.counterparty_ico),
    counterparty_dic: aiSource("counterparty_dic", data.counterparty_dic),
    counterparty_email: aiSource("counterparty_email", data.counterparty_email),
    variable_symbol: aiSource("variable_symbol", data.variable_symbol),
    amount_without_vat: aiSource("amount_without_vat", data.amount_without_vat),
    vat_rate: aiSource("vat_rate", data.vat_rate),
    amount: aiSource("amount", data.amount),
    currency: aiSource("currency", data.currency),
    issue_date: aiSource("issue_date", data.issue_date),
    due_date: aiSource("due_date", data.due_date),
  };

  return {
    invoice,
    field_sources: fieldSources,
    field_decisions: deriveOcrFieldDecisions(invoice, fieldSources, warnings),
    confidence: amount && invoice.counterparty_name && invoice.invoice_number ? 0.7 : 0.3,
    warnings,
    document_kind: "issued_invoice",
    issuer_matches_organization: null,
    model: `gemini:${model}`,
    response_id: responseId,
    vocabulary_version: OCR_VOCABULARY_VERSION,
    keyword_suggestions: [],
  };
}
