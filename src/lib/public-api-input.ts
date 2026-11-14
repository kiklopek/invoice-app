import { createHash } from "node:crypto";
import { isValidEmail } from "./auth-policy";
import { isIsoDate } from "./invoice-validation";
import { INVOICE_CURRENCIES } from "./invoice-currency";

export class PublicApiError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "invalid_request", readonly details: Record<string, unknown> = {}) { super(message); }
}
export const API_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function apiObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PublicApiError("Očekává se JSON objekt.");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !allowed.includes(key))) throw new PublicApiError("Požadavek obsahuje nepodporované pole.");
  return result;
}
export function apiText(value: unknown, name: string, max: number, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new PublicApiError(`Neplatné pole ${name}.`);
  return value.trim();
}
function decimal(value: unknown, name: string, precision: number, max: number, positive = false) {
  if ((typeof value !== "string" && typeof value !== "number") || !new RegExp(`^\\d{1,12}(?:\\.\\d{1,${precision}})?$`).test(String(value))) throw new PublicApiError(`Neplatné desetinné číslo ${name}.`);
  const result = Number(value);
  if (!Number.isFinite(result) || result > max || result < 0 || (positive && !result)) throw new PublicApiError(`Částka nebo množství ${name} je mimo povolený rozsah.`);
  return String(value);
}
export function apiMoney(value: unknown, name: string) { return Number(decimal(value, name, 2, 999_999_999_999.99)); }
export function customerApiBody(value: unknown) {
  const row = apiObject(value, ["name", "address", "email", "ico", "dic"]);
  const customer = { name: apiText(row.name, "customer.name", 200, true), address: apiText(row.address, "customer.address", 500, true), email: apiText(row.email, "customer.email", 254).toLowerCase(), ico: apiText(row.ico, "customer.ico", 8), dic: apiText(row.dic, "customer.dic", 24) };
  if ((customer.email && !isValidEmail(customer.email)) || (customer.ico && !/^\d{8}$/.test(customer.ico))) throw new PublicApiError("Zkontrolujte e-mail a IČO zákazníka.");
  return customer;
}
export function invoiceApiBody(value: unknown) {
  const row = apiObject(value, ["request_id", "variable_symbol", "issue_date", "due_date", "tax_date", "currency", "payment_method", "paid_amount", "payment_confirmed", "customer", "items", "expected_total", "public_note", "internal_note"]);
  const issue_date = apiText(row.issue_date, "issue_date", 10, true), due_date = apiText(row.due_date, "due_date", 10, true), tax_date = row.tax_date === undefined ? issue_date : apiText(row.tax_date, "tax_date", 10, true);
  if (![issue_date, due_date, tax_date].every(isIsoDate) || due_date < issue_date) throw new PublicApiError("Zkontrolujte datum vystavení, DUZP a splatnost.");
  const currency = row.currency === undefined ? "CZK" : apiText(row.currency, "currency", 3, true);
  if (!(INVOICE_CURRENCIES as readonly string[]).includes(currency)) throw new PublicApiError("Nepodporovaná měna.");
  const payment_method = row.payment_method === undefined ? "bank" : row.payment_method;
  if (payment_method !== "bank" && payment_method !== "cash") throw new PublicApiError("Nepodporovaný způsob platby.");
  const variable_symbol = apiText(row.variable_symbol, "variable_symbol", 10);
  if (variable_symbol && !/^\d{1,10}$/.test(variable_symbol)) throw new PublicApiError("Variabilní symbol musí mít 1 až 10 číslic.");
  const request_id = apiText(row.request_id, "request_id", 36);
  if (request_id && !API_UUID.test(request_id)) throw new PublicApiError("request_id musí být UUID objednávky.");
  if (!Array.isArray(row.items) || !row.items.length || row.items.length > 200) throw new PublicApiError("Faktura musí mít 1 až 200 položek.");
  const items = row.items.map(value => {
    const item = apiObject(value, ["description", "quantity", "unit", "unit_price_gross", "vat_rate"]);
    const rate = item.vat_rate;
    if (rate !== null && (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100 || Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-8)) throw new PublicApiError("Neplatná sazba DPH.");
    return { description: apiText(item.description, "items.description", 500, true), quantity: decimal(item.quantity, "items.quantity", 6, 1_000_000, true), unit: apiText(item.unit, "items.unit", 20, true), unit_price_gross: decimal(item.unit_price_gross, "items.unit_price_gross", 2, 999_999_999_999.99), vat_rate: rate as number | null };
  });
  const expected_total = apiMoney(row.expected_total, "expected_total"), paid_amount = row.paid_amount === undefined ? 0 : apiMoney(row.paid_amount, "paid_amount");
  if (!expected_total || paid_amount > expected_total || (paid_amount > 0 && row.payment_confirmed !== true) || (row.payment_confirmed !== undefined && typeof row.payment_confirmed !== "boolean")) throw new PublicApiError("Úhrada musí být výslovně potvrzená a nesmí převýšit celkovou částku.");
  return { request_id, variable_symbol, issue_date, due_date, tax_date, currency, payment_method, paid_amount, payment_confirmed: paid_amount > 0, customer: customerApiBody(row.customer), items, expected_total, public_note: apiText(row.public_note, "public_note", 2000), internal_note: apiText(row.internal_note, "internal_note", 5000) };
}
export function apiOperationId(organizationId: string, operation: string, key: string) {
  const bytes = createHash("sha256").update(JSON.stringify(["splatno-api-v1", organizationId, operation, key])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function apiIdempotencyKey(request: Request, legacy?: string) {
  const key = request.headers.get("idempotency-key") ?? legacy;
  if (!key || !/^[A-Za-z0-9_.:-]{1,100}$/.test(key)) throw new PublicApiError("Zadejte hlavičku Idempotency-Key (1 až 100 znaků).", 400, "idempotency_key_required");
  if (request.headers.has("idempotency-key") && legacy && key !== legacy) throw new PublicApiError("request_id a Idempotency-Key se nesmějí lišit.");
  return key;
}
export function encodeApiCursor(row: { created_at: string; id: string }) { return Buffer.from(JSON.stringify([row.created_at, row.id])).toString("base64url"); }
export function apiPage(url: URL) {
  const rawLimit = url.searchParams.get("limit") ?? "50";
  if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) throw new PublicApiError("limit musí být 1 až 100.");
  const raw = url.searchParams.get("cursor");
  let cursor: { created_at: string; id: string } | null = null;
  if (raw) {
    try {
      if (raw.length > 256 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw Error();
      const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString());
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value[0]) || !Number.isFinite(Date.parse(value[0])) || typeof value[1] !== "string" || !API_UUID.test(value[1])) throw Error();
      cursor = { created_at: value[0], id: value[1] };
    } catch { throw new PublicApiError("Neplatný stránkovací kurzor."); }
  }
  return { limit: Number(rawLimit), cursor };
}
export function stableApiHash(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,normalize(v)])) : v;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}
