import "server-only";

import { boundedText, type InvoiceOcrOrganization, type InvoiceOcrResult, type OcrFieldName, type OcrFieldSource } from "@/lib/invoice-ocr";
import { grossFromNet, netFromGross, roundMoney, vatAmountsMatch } from "@/lib/vat";
import type { InvoiceInput } from "@/types/invoice";

// This is the ONE place in the app where a document -- and everything on
// it: counterparty name, e-mail, IČO, amounts, our own bank account -- is
// sent to a third party. Opt-in only (OCR_PROVIDER=openrouter), and every
// result carries an explicit warning saying so, because a person confirming
// this import has a right to know the document left the company before
// they click "uložit". See the conversation this was built from for the
// GDPR/data-processor reasoning: this is acceptable for a deliberate test,
// not something to flip on for real customer documents without reading
// OpenRouter's (and whichever free model gets routed to) data-processing
// terms for the account in use.
export class OpenRouterOcrError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL?.trim() || "openrouter/free";
export const OPENROUTER_OCR_DISCLOSURE =
  "Tento dokument byl kvůli rozpoznání údajů odeslán externí AI službě (OpenRouter). Než fakturu uložíte, zkontrolujte všechny údaje.";

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    invoice_number: { type: "string" },
    counterparty_name: { type: "string" },
    counterparty_ico: { type: "string" },
    counterparty_dic: { type: "string" },
    counterparty_email: { type: "string" },
    variable_symbol: { type: "string" },
    amount_without_vat: { type: "number" },
    vat_rate: { type: "number" },
    amount: { type: "number" },
    currency: { type: "string" },
    issue_date: { type: "string", description: "YYYY-MM-DD" },
    due_date: { type: "string", description: "YYYY-MM-DD" },
  },
  required: ["invoice_number", "amount_without_vat", "vat_rate", "amount"],
  additionalProperties: false,
};

const PROMPT = `Jsi asistent pro čtení českých faktur. Z přiloženého dokumentu vytáhni pole
podle schématu přesně tak, jak jsou na faktuře napsaná -- nikdy nic
nepočítej ani neodhaduj, pokud to na dokumentu není přímo napsané.
amount_without_vat je základ daně (částka bez DPH), amount je celková částka
k úhradě (s DPH), vat_rate je sazba DPH v procentech. counterparty_* se týká
ODBĚRATELE (kdo má fakturu zaplatit), nikdy dodavatele/vystavitele faktury.
Data vracej jako YYYY-MM-DD. Pole, které na dokumentu není, vynech nebo
vrať jako prázdný řetězec -- nikdy si žádnou hodnotu nevymýšlej.
Odpověz JEN validním JSON objektem podle schématu, nic jiného.`;

type OpenRouterExtraction = Partial<{
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
}>;

function isIsoDateLike(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// openrouter/free routes to a RANDOM free model per request, and they vary
// wildly in whether they actually follow "reply with JSON only" -- one
// attempt landing on a model that ignores the schema and replies with prose
// (or nothing at all) is expected, not exceptional. Retrying gives the
// router a fresh chance to land on a model that behaves, which in practice
// is far more effective than trying to out-prompt every possible model's
// quirks. Never retry "not_configured" (a missing key retrying won't fix).
const MAX_ATTEMPTS = 2;

async function callOpenRouter(bytes: Uint8Array, mime: string): Promise<{ data: OpenRouterExtraction; model: string; responseId: string | null }> {
  let lastError: OpenRouterOcrError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callOpenRouterOnce(bytes, mime);
    } catch (cause) {
      if (!(cause instanceof OpenRouterOcrError) || cause.code === "not_configured") throw cause;
      lastError = cause;
      console.error(`[invoice-ocr-openrouter] pokus ${attempt}/${MAX_ATTEMPTS} selhal (${cause.code}), ${attempt < MAX_ATTEMPTS ? "zkouším znovu" : "vzdávám se"}`);
      if (attempt < MAX_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError ?? new OpenRouterOcrError("AI OCR selhalo bez konkrétní chyby.", "api_error");
}

async function callOpenRouterOnce(bytes: Uint8Array, mime: string): Promise<{ data: OpenRouterExtraction; model: string; responseId: string | null }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new OpenRouterOcrError("AI OCR (OpenRouter) není nakonfigurováno.", "not_configured");

  const isPdf = mime === "application/pdf";
  const base64 = Buffer.from(bytes).toString("base64");
  const content = isPdf
    ? [
        { type: "text", text: PROMPT },
        { type: "file", file: { filename: "invoice.pdf", file_data: `data:application/pdf;base64,${base64}` } },
      ]
    : [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
      ];

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter attribution headers -- not secret, identify the calling app.
        "HTTP-Referer": process.env.APP_BASE_URL?.trim() || "https://www.splatno.cz",
        "X-Title": "Splatno",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: "user", content }],
        // openrouter/free routes to whichever free model is available, and not
        // all of them honor strict json_schema mode -- response_format here is
        // a best-effort hint. The JSON.parse below is the real contract; a
        // model that ignores this still gets caught by the try/catch as a
        // clean "extraction failed", not a corrupted result.
        response_format: { type: "json_schema", json_schema: { name: "invoice_extraction", strict: false, schema: EXTRACTION_SCHEMA } },
      }),
      // Short per-attempt budget on purpose: the extract route has a hard
      // maxDuration of 60s total, and up to MAX_ATTEMPTS retries share that
      // one budget -- 3 attempts at 45s each would blow past it on their own.
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    // AbortSignal.timeout rejects the fetch itself (never produces a
    // response), so it lands here, not in the !response.ok branch below.
    // A slow model on one random routing is exactly what a retry is for.
    throw new OpenRouterOcrError("OpenRouter neodpovědělo včas.", "timeout");
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[invoice-ocr-openrouter] API error", { status: response.status, body: body.slice(0, 1000) });
    throw new OpenRouterOcrError(`OpenRouter API vrátilo chybu (${response.status}).`, response.status === 429 ? "rate_limited" : "api_error");
  }
  const payload = await response.json() as { id?: string; model?: string; choices?: Array<{ message?: { content?: string } }> };
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new OpenRouterOcrError("OpenRouter nevrátilo žádný text.", "empty_response");

  // A model outside strict json_schema support sometimes wraps the JSON in
  // prose or a ```json fence despite the prompt -- salvage the first
  // {...} block rather than failing outright on otherwise-good output.
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new OpenRouterOcrError("Odpověď AI nebyla platný JSON.", "invalid_json");
  }
  if (typeof parsed !== "object" || parsed === null) throw new OpenRouterOcrError("Odpověď AI nebyla platný objekt.", "invalid_json");
  return { data: parsed as OpenRouterExtraction, model: payload.model ?? OPENROUTER_MODEL, responseId: payload.id ?? null };
}

export async function extractInvoiceWithOpenRouter({
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
  const called = await callOpenRouter(bytes, mime);
  const { model, responseId } = called;
  let data = called.data;

  const amount = typeof data.amount === "number" && Number.isFinite(data.amount) ? roundMoney(Math.max(0, data.amount)) : 0;
  const amountWithoutVat = typeof data.amount_without_vat === "number" && Number.isFinite(data.amount_without_vat) ? roundMoney(Math.max(0, data.amount_without_vat)) : 0;
  const vatRate = typeof data.vat_rate === "number" && Number.isFinite(data.vat_rate) ? roundMoney(Math.max(0, Math.min(100, data.vat_rate))) : 0;

  const warnings: string[] = [OPENROUTER_OCR_DISCLOSURE];
  // Same class of bug fixed today in the local parser's e-mail extraction:
  // nothing stops an AI from reading the SUPPLIER section as the customer on
  // an unfamiliar layout. Guard the one field with a cheap, certain check --
  // our own IČO can never legitimately be the counterparty.
  const ownIco = organization.ico?.replace(/[^0-9]/g, "") || null;
  if (ownIco && data.counterparty_ico?.replace(/[^0-9]/g, "") === ownIco) {
    data = { ...data, counterparty_ico: "", counterparty_name: "", counterparty_email: "" };
    warnings.push("AI rozpoznala jako odběratele vaši vlastní firmu -- údaje byly vynechány, doplňte je ručně.");
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
  const aiSource = (value: unknown): OcrFieldSource | undefined =>
    value ? { page: 1, line: 0, text: String(value), method: "ai", confidence: null, bounds: null } : undefined;
  const fieldSources: Partial<Record<OcrFieldName, OcrFieldSource>> = {
    invoice_number: aiSource(data.invoice_number),
    counterparty_name: aiSource(data.counterparty_name),
    counterparty_ico: aiSource(data.counterparty_ico),
    counterparty_dic: aiSource(data.counterparty_dic),
    counterparty_email: aiSource(data.counterparty_email),
    variable_symbol: aiSource(data.variable_symbol),
    amount_without_vat: aiSource(data.amount_without_vat),
    vat_rate: aiSource(data.vat_rate),
    amount: aiSource(data.amount),
    currency: aiSource(data.currency),
  };

  return {
    invoice,
    field_sources: fieldSources,
    confidence: amount && invoice.counterparty_name && invoice.invoice_number ? 0.7 : 0.3,
    warnings,
    document_kind: "issued_invoice",
    issuer_matches_organization: null,
    model: `openrouter:${model}`,
    response_id: responseId,
  };
}
