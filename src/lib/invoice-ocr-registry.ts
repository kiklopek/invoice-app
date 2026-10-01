import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  deriveOcrFieldDecisions,
  digits,
  findLocalGeometry,
  isValidCzSkIco,
  normalizeComparable,
  type InvoiceOcrResult,
  type InvoiceOcrOrganization,
  type OcrFieldCandidate,
  type OcrFieldName,
  type OcrFieldSource,
} from "@/lib/invoice-ocr";
import { lookupAresSubject } from "@/lib/ares";

const ARES_CACHE_MS = 30 * 24 * 60 * 60_000;

type RegistryResult = {
  status: "found" | "not_found" | "unavailable";
  legalName: string | null;
  dic: string | null;
  source: "cache" | "ares" | "none";
};

function rejectedIdentityCandidate(result: InvoiceOcrResult, field: "counterparty_ico" | "counterparty_dic" | "counterparty_name", value: string) {
  const source = result.field_sources[field];
  // The box is kept only when the source really is the reading of `value`.
  const geometry = findLocalGeometry(field, value, { source, sourceValue: result.invoice[field] ?? "" });
  return {
    value,
    page: source?.page ?? 1,
    text: source?.text ?? value,
    method: source?.method ?? "ocr" as const,
    confidence: source?.confidence ?? null,
    role: source?.role ?? "counterparty" as const,
    ...(geometry ? { bounds: geometry.bounds } : {}),
  };
}

// Final provider-independent guard. Local OCR and Gemini both try to keep the
// supplier identity out of counterparty fields, but every extraction path is
// routed through this check as the last line of defence. A value equal to the
// current organization's identity is the issuer's identity by definition and
// must never be prefilled as the customer who owes the invoice.
export function rejectOrganizationIdentity(
  result: InvoiceOcrResult,
  organization: InvoiceOcrOrganization,
): InvoiceOcrResult {
  const ownIco = digits(organization.ico ?? "");
  const extractedIco = digits(result.invoice.counterparty_ico ?? "");
  const ownDic = normalizeComparable(organization.dic).toUpperCase();
  const extractedDic = normalizeComparable(result.invoice.counterparty_dic).toUpperCase();
  const icoMatches = Boolean(ownIco && extractedIco && ownIco === extractedIco);
  const dicMatches = Boolean(ownDic && extractedDic && ownDic === extractedDic);
  if (!icoMatches && !dicMatches) return result;

  const originalIco = result.invoice.counterparty_ico;
  const originalDic = result.invoice.counterparty_dic;
  const invoice = {
    ...result.invoice,
    counterparty_ico: icoMatches ? "" : result.invoice.counterparty_ico,
    // If the IČO is the issuer's, its paired DIČ is unsafe even when OCR
    // mangled it enough to miss an exact DIČ comparison.
    counterparty_dic: icoMatches || dicMatches ? "" : result.invoice.counterparty_dic,
  };
  const warning = "IČO vlastní firmy bylo nalezeno v údajích odběratele a nebylo předvyplněno. Doplňte IČO firmy, která má fakturu zaplatit.";
  const warnings = [...new Set([...result.warnings, warning])];
  const reasons: Partial<Record<"counterparty_ico" | "counterparty_dic", string[]>> = {};
  if (icoMatches) reasons.counterparty_ico = [`Odmítnutý kandidát: ${originalIco}. Toto IČO patří vystaviteli faktury (${organization.name}), nikoli odběrateli.`];
  if (originalDic && (icoMatches || dicMatches)) reasons.counterparty_dic = [`DIČ ${originalDic} nebylo použito, protože odpovídá identitě vystavitele nebo souvisí s jeho IČO.`];
  const decisions = identityDecisions(result, invoice, result.field_sources, warnings, reasons);
  if (icoMatches && decisions.counterparty_ico && originalIco) {
    decisions.counterparty_ico.candidates = [{
      ...rejectedIdentityCandidate(result, "counterparty_ico", originalIco),
      role: "issuer",
    }];
  }
  if ((icoMatches || dicMatches) && decisions.counterparty_dic && originalDic) {
    decisions.counterparty_dic.candidates = [{
      ...rejectedIdentityCandidate(result, "counterparty_dic", originalDic),
      role: "issuer",
    }];
  }
  return { ...result, invoice, warnings, field_decisions: decisions, confidence: Math.min(result.confidence, 0.49) };
}

function companyNameTokens(value: string) {
  const withoutLegalForm = value
    .replace(/\b(?:s\.?\s*r\.?\s*o\.?|a\.?\s*s\.?|spol\.?\s+s\.?\s*r\.?\s*o\.?|osvc|z\.?\s*s\.?)\b/giu, " ");
  return new Set(withoutLegalForm.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("cs")
    .split(/[^a-z0-9]+/).filter(token => token.length >= 2));
}

export function companyNamesAgree(left: string, right: string) {
  const normalizedLeft = normalizeComparable(left);
  const normalizedRight = normalizeComparable(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return true;
  const leftTokens = companyNameTokens(left);
  const rightTokens = companyNameTokens(right);
  const intersection = [...leftTokens].filter(token => rightTokens.has(token));
  return intersection.length >= 2;
}

type AresLookupFn = typeof lookupAresSubject;

async function lookupAres(client: SupabaseClient<Database>, ico: string, lookup: AresLookupFn): Promise<RegistryResult> {
  const ares = await lookup(ico);
  if (ares.status === "found" || ares.status === "not_found") {
    const legalName = ares.status === "found" ? ares.subject.name : null;
    // Databázová cache je jen záloha pro výpadek ARES; její zápis je best-effort.
    try {
      await client.from("company_registry_cache").upsert({
        ico,
        legal_name: legalName,
        lookup_status: ares.status,
        fetched_at: new Date().toISOString(),
      }, { onConflict: "ico" });
    } catch {
      // Selhání cache nesmí ovlivnit výsledek ověření.
    }
    return {
      status: ares.status,
      legalName,
      dic: ares.status === "found" ? ares.subject.dic : null,
      source: ares.status === "found" && ares.cached ? "cache" : "ares",
    };
  }
  if (ares.status === "invalid_ico") return { status: "not_found", legalName: null, dic: null, source: "none" };
  try {
    const { data: cached } = await client.from("company_registry_cache")
      .select("legal_name, lookup_status, fetched_at")
      .eq("ico", ico)
      .maybeSingle();
    if (cached && Date.parse(cached.fetched_at) >= Date.now() - ARES_CACHE_MS) {
      return { status: cached.lookup_status === "found" ? "found" : "not_found", legalName: cached.legal_name, dic: null, source: "cache" };
    }
  } catch {
    // Bez cache i bez ARES: "nedostupné" níže.
  }
  return { status: "unavailable", legalName: null, dic: null, source: "none" };
}

export const ARES_UNAVAILABLE_WARNING = "Registr ARES teď nebyl dostupný, identitu odběratele se nepodařilo ověřit v registru.";

const IDENTITY_FIELDS = ["counterparty_name", "counterparty_ico", "counterparty_dic"] as const;

// Přepočítá rozhodnutí jen u identitních polí; rozhodnutí ostatních polí
// (shody zdrojů, potvrzení, kandidáti) zůstávají, jak je nastavily předchozí kroky.
function identityDecisions(result: InvoiceOcrResult, invoice: InvoiceOcrResult["invoice"], fieldSources: InvoiceOcrResult["field_sources"], warnings: string[], reasons: Partial<Record<OcrFieldName, string[]>> = {}) {
  const derived = deriveOcrFieldDecisions(invoice, fieldSources, warnings, reasons);
  const decisions = { ...result.field_decisions };
  for (const field of IDENTITY_FIELDS) decisions[field] = derived[field];
  return decisions;
}

function aresSource(text: string): OcrFieldSource {
  return { page: 1, line: 0, text: text.slice(0, 240), method: "ares", confidence: 0.97, bounds: null, role: "counterparty" };
}

function aresCandidate(value: string): OcrFieldCandidate {
  return { value, page: 1, text: `ARES: ${value}`, method: "ares", confidence: 0.97, role: "counterparty" };
}

export async function validateCounterpartyWithAres(
  result: InvoiceOcrResult,
  client: SupabaseClient<Database>,
  { lookup = lookupAresSubject }: { lookup?: AresLookupFn } = {},
): Promise<InvoiceOcrResult> {
  const ico = digits(result.invoice.counterparty_ico ?? "");
  if (!ico) return result;

  // ARES is authoritative only for Czech subjects. An explicitly Slovak or
  // other foreign VAT ID must never be rejected because ARES does not know it.
  const vatCountry = result.invoice.counterparty_dic?.trim().match(/^([A-Z]{2})/i)?.[1]?.toUpperCase();
  if (vatCountry && vatCountry !== "CZ") return result;

  if (!isValidCzSkIco(ico)) {
    const originalIco = result.invoice.counterparty_ico;
    const originalDic = result.invoice.counterparty_dic;
    const invoice = { ...result.invoice, counterparty_ico: "", counterparty_dic: "" };
    const warning = "Nalezené IČO neprošlo kontrolním součtem a nebylo předvyplněno. Zkontrolujte identitu odběratele ručně.";
    const warnings = [...new Set([...result.warnings, warning])];
    const decisions = identityDecisions(result, invoice, result.field_sources, warnings, {
      counterparty_ico: [`Odmítnutý kandidát: ${originalIco}. Neplatný kontrolní součet.`],
      counterparty_dic: originalDic ? [`DIČ ${originalDic} nebylo použito, protože související IČO je neplatné.`] : [],
    });
    if (decisions.counterparty_ico && originalIco) decisions.counterparty_ico.candidates = [rejectedIdentityCandidate(result, "counterparty_ico", originalIco)];
    if (decisions.counterparty_dic && originalDic) decisions.counterparty_dic.candidates = [rejectedIdentityCandidate(result, "counterparty_dic", originalDic)];
    return { ...result, invoice, warnings, field_decisions: decisions, confidence: Math.min(result.confidence, 0.59) };
  }

  const registry = await lookupAres(client, ico, lookup);
  if (registry.status === "unavailable") {
    return { ...result, warnings: [...new Set([...result.warnings, ARES_UNAVAILABLE_WARNING])] };
  }

  const documentName = result.invoice.counterparty_name?.trim() ?? "";
  if (registry.status === "not_found" || !registry.legalName || (documentName && !companyNamesAgree(documentName, registry.legalName))) {
    const originalIco = result.invoice.counterparty_ico;
    const originalDic = result.invoice.counterparty_dic;
    const nameConflict = Boolean(registry.status === "found" && registry.legalName && documentName);
    const invoice = { ...result.invoice, counterparty_ico: "", counterparty_dic: "", ...(nameConflict ? { counterparty_name: "" } : {}) };
    const warning = registry.status === "not_found"
      ? "IČO nebylo potvrzeno v ARES a nebylo předvyplněno. Zkontrolujte odběratele ručně."
      : `Název odběratele neodpovídá subjektu vedenému v ARES (${registry.legalName}) a IČO nebylo předvyplněno.`;
    const warnings = [...new Set([...result.warnings, warning])];
    const fieldSources = { ...result.field_sources };
    if (nameConflict) delete fieldSources.counterparty_name;
    const decisions = identityDecisions(result, invoice, fieldSources, warnings, {
      counterparty_ico: [`Odmítnutý kandidát: ${originalIco}. ARES nepotvrdil vazbu na odběratele.`],
      counterparty_dic: originalDic ? [`DIČ ${originalDic} nebylo použito, protože ARES nepotvrdil vazbu IČO na odběratele.`] : [],
      ...(nameConflict ? { counterparty_name: [`Název v dokumentu (${documentName}) se liší od názvu v ARES (${registry.legalName}). Vyberte správný.`] } : {}),
    });
    if (decisions.counterparty_ico && originalIco) decisions.counterparty_ico.candidates = [rejectedIdentityCandidate(result, "counterparty_ico", originalIco)];
    if (decisions.counterparty_dic && originalDic) decisions.counterparty_dic.candidates = [rejectedIdentityCandidate(result, "counterparty_dic", originalDic)];
    if (nameConflict && decisions.counterparty_name) {
      decisions.counterparty_name.status = "review";
      decisions.counterparty_name.candidates = [
        rejectedIdentityCandidate(result, "counterparty_name", documentName),
        aresCandidate(registry.legalName!),
      ];
    }
    return { ...result, invoice, field_sources: fieldSources, warnings, field_decisions: decisions, confidence: Math.min(result.confidence, 0.59) };
  }

  // IČO odpovídá subjektu v ARES. Prázdné pole doplníme z ARES, rozdílné DIČ
  // nikdy nepřepíšeme -- jde k ověření s oběma hodnotami.
  const invoice = { ...result.invoice };
  const fieldSources = { ...result.field_sources };
  const reasons: Partial<Record<OcrFieldName, string[]>> = {};
  let warnings = [...result.warnings];
  const cacheNote = registry.source === "cache" ? " z cache" : "";
  if (!documentName) {
    invoice.counterparty_name = registry.legalName.slice(0, 200);
    fieldSources.counterparty_name = aresSource(`ARES: ${registry.legalName}`);
    warnings = warnings.filter(warning => warning !== "Název odběratele nebyl rozpoznán.");
  }
  const documentDic = invoice.counterparty_dic?.replace(/[\s-]/g, "").toUpperCase() ?? "";
  let dicConflict: string | null = null;
  if (registry.dic && !documentDic) {
    invoice.counterparty_dic = registry.dic;
    fieldSources.counterparty_dic = aresSource(`ARES: ${registry.dic}`);
  } else if (registry.dic && documentDic && documentDic !== registry.dic) {
    dicConflict = invoice.counterparty_dic ?? documentDic;
    invoice.counterparty_dic = "";
    delete fieldSources.counterparty_dic;
    reasons.counterparty_dic = [`DIČ v dokumentu (${dicConflict}) se liší od DIČ v ARES (${registry.dic}). Vyberte správné.`];
    warnings.push(`DIČ odběratele v dokumentu (${dicConflict}) neodpovídá registru ARES (${registry.dic}) – zkontrolujte ho.`);
  }
  warnings = [...new Set(warnings)];
  const fieldDecisions = identityDecisions(result, invoice, fieldSources, warnings, reasons);
  const icoWasVerifiable = result.field_decisions.counterparty_ico?.status !== "review" || !result.field_decisions.counterparty_ico?.candidates.length;
  if (fieldDecisions.counterparty_ico && icoWasVerifiable && fieldDecisions.counterparty_ico.status !== "missing") fieldDecisions.counterparty_ico = {
    ...fieldDecisions.counterparty_ico,
    status: "verified",
    confidence: Math.max(0.98, fieldDecisions.counterparty_ico.confidence),
    reasons: [`IČO a název odběratele byly ověřeny v ARES${cacheNote}.`],
  };
  const icoVerified = fieldDecisions.counterparty_ico?.status === "verified";
  for (const field of ["counterparty_name", "counterparty_dic"] as const) {
    const decision = fieldDecisions[field];
    if (!decision || decision.status === "missing" || (field === "counterparty_dic" && dicConflict)) continue;
    const fromAres = fieldSources[field]?.method === "ares";
    const confirmedByAres = field === "counterparty_name" ? true : Boolean(registry.dic);
    if ((fromAres || confirmedByAres) && icoVerified && decision.reasons.every(reason => !reason.includes("kontrolním součtem"))) {
      fieldDecisions[field] = {
        ...decision,
        status: "verified",
        confidence: Math.max(decision.confidence, 0.95),
        reasons: [fromAres ? `Doplněno z ARES podle ověřeného IČO${cacheNote}.` : `Potvrzeno registrem ARES${cacheNote}.`],
        needs_confirmation: undefined,
      };
    } else if (fromAres) {
      fieldDecisions[field] = { ...decision, status: "review", needs_confirmation: true, reasons: [...decision.reasons, "Doplněno z ARES, ale IČO samo ověřené není. Potvrďte."] };
    }
  }
  if (dicConflict && fieldDecisions.counterparty_dic) {
    fieldDecisions.counterparty_dic = {
      ...fieldDecisions.counterparty_dic,
      status: "review",
      candidates: [rejectedIdentityCandidate(result, "counterparty_dic", dicConflict), aresCandidate(registry.dic!)],
    };
  }
  return { ...result, invoice, field_sources: fieldSources, warnings, field_decisions: fieldDecisions };
}
