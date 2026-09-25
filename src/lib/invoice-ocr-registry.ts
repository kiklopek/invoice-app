import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  deriveOcrFieldDecisions,
  digits,
  isValidCzSkIco,
  normalizeComparable,
  type InvoiceOcrResult,
  type InvoiceOcrOrganization,
} from "@/lib/invoice-ocr";

const ARES_CACHE_MS = 30 * 24 * 60 * 60_000;
const ARES_TIMEOUT_MS = 2_000;

type RegistryResult = {
  status: "found" | "not_found" | "unavailable";
  legalName: string | null;
  source: "cache" | "ares" | "none";
};

function rejectedIdentityCandidate(result: InvoiceOcrResult, field: "counterparty_ico" | "counterparty_dic", value: string) {
  const source = result.field_sources[field];
  return {
    value,
    page: source?.page ?? 1,
    text: source?.text ?? value,
    method: source?.method ?? "ocr" as const,
    confidence: source?.confidence ?? null,
    role: source?.role ?? "counterparty" as const,
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
  const decisions = deriveOcrFieldDecisions(invoice, result.field_sources, warnings, reasons);
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

async function lookupAres(client: SupabaseClient<Database>, ico: string): Promise<RegistryResult> {
  const { data: cached } = await client.from("company_registry_cache")
    .select("legal_name, lookup_status, fetched_at")
    .eq("ico", ico)
    .maybeSingle();
  if (cached && Date.parse(cached.fetched_at) >= Date.now() - ARES_CACHE_MS) {
    return {
      status: cached.lookup_status === "found" ? "found" : "not_found",
      legalName: cached.legal_name,
      source: "cache",
    };
  }

  try {
    const response = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${encodeURIComponent(ico)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(ARES_TIMEOUT_MS),
      cache: "no-store",
    });
    const status: RegistryResult["status"] = response.status === 404 ? "not_found" : response.ok ? "found" : "unavailable";
    if (status === "unavailable") return { status, legalName: null, source: "none" };
    const payload = response.ok ? await response.json().catch(() => null) as { obchodniJmeno?: unknown } | null : null;
    const legalName = typeof payload?.obchodniJmeno === "string" ? payload.obchodniJmeno.trim().slice(0, 240) : null;
    const finalStatus = status === "found" && legalName ? "found" : "not_found";
    await client.from("company_registry_cache").upsert({
      ico,
      legal_name: legalName,
      lookup_status: finalStatus,
      fetched_at: new Date().toISOString(),
    }, { onConflict: "ico" });
    return { status: finalStatus, legalName, source: "ares" };
  } catch {
    return { status: "unavailable", legalName: null, source: "none" };
  }
}

export async function validateCounterpartyWithAres(result: InvoiceOcrResult, client: SupabaseClient<Database>): Promise<InvoiceOcrResult> {
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
    const decisions = deriveOcrFieldDecisions(invoice, result.field_sources, warnings, {
      counterparty_ico: [`Odmítnutý kandidát: ${originalIco}. Neplatný kontrolní součet.`],
      counterparty_dic: originalDic ? [`DIČ ${originalDic} nebylo použito, protože související IČO je neplatné.`] : [],
    });
    if (decisions.counterparty_ico && originalIco) decisions.counterparty_ico.candidates = [rejectedIdentityCandidate(result, "counterparty_ico", originalIco)];
    if (decisions.counterparty_dic && originalDic) decisions.counterparty_dic.candidates = [rejectedIdentityCandidate(result, "counterparty_dic", originalDic)];
    return { ...result, invoice, warnings, field_decisions: decisions, confidence: Math.min(result.confidence, 0.59) };
  }

  const registry = await lookupAres(client, ico);
  if (registry.status === "unavailable") return result;
  if (registry.status === "not_found" || !registry.legalName || !companyNamesAgree(result.invoice.counterparty_name, registry.legalName)) {
    const originalIco = result.invoice.counterparty_ico;
    const originalDic = result.invoice.counterparty_dic;
    const invoice = { ...result.invoice, counterparty_ico: "", counterparty_dic: "" };
    const warning = registry.status === "not_found"
      ? "IČO nebylo potvrzeno v ARES a nebylo předvyplněno. Zkontrolujte odběratele ručně."
      : `Název odběratele neodpovídá subjektu vedenému v ARES (${registry.legalName}) a IČO nebylo předvyplněno.`;
    const warnings = [...new Set([...result.warnings, warning])];
    const decisions = deriveOcrFieldDecisions(invoice, result.field_sources, warnings, {
      counterparty_ico: [`Odmítnutý kandidát: ${originalIco}. ARES nepotvrdil vazbu na odběratele.`],
      counterparty_dic: originalDic ? [`DIČ ${originalDic} nebylo použito, protože ARES nepotvrdil vazbu IČO na odběratele.`] : [],
    });
    if (decisions.counterparty_ico && originalIco) decisions.counterparty_ico.candidates = [rejectedIdentityCandidate(result, "counterparty_ico", originalIco)];
    if (decisions.counterparty_dic && originalDic) decisions.counterparty_dic.candidates = [rejectedIdentityCandidate(result, "counterparty_dic", originalDic)];
    return {
      ...result,
      invoice,
      warnings,
      field_decisions: decisions,
      confidence: Math.min(result.confidence, 0.59),
    };
  }

  const fieldDecisions = deriveOcrFieldDecisions(result.invoice, result.field_sources, result.warnings);
  if (fieldDecisions.counterparty_ico) fieldDecisions.counterparty_ico = {
    ...fieldDecisions.counterparty_ico,
    status: "verified",
    confidence: Math.max(0.98, fieldDecisions.counterparty_ico.confidence),
    reasons: [`IČO a název odběratele byly ověřeny v ARES${registry.source === "cache" ? " z cache" : ""}.`],
  };
  return { ...result, field_decisions: fieldDecisions };
}
