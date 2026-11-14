import "server-only";
import { ApiKeyError, getApiKeyIdentity, recordApiKeyRequest, type ApiKeyIdentity, type ApiKeyScope } from "./auth-api-key";
import { logError, requestId } from "./structured-log";
import { InvoiceCreationError } from "./invoice-creation";
import { InvoiceIssueError } from "./invoice-issue-server";
import { API_UUID, PublicApiError } from "./public-api-input";

export type ApiContext = ApiKeyIdentity;
export async function publicApi(request: Request, scope: ApiKeyScope, operation: (identity: ApiContext) => Promise<Response>) {
  const started = performance.now();
  let identity: ApiContext | undefined;
  let response: Response;
  try {
    identity = await getApiKeyIdentity(request, scope);
    response = await operation(identity);
  } catch (error) {
    const known = error instanceof ApiKeyError || error instanceof PublicApiError || error instanceof InvoiceCreationError;
    const status = known ? error.status : 503;
    const code = error instanceof ApiKeyError || error instanceof PublicApiError || error instanceof InvoiceIssueError ? error.code : error instanceof InvoiceCreationError ? "invoice_validation_failed" : "service_unavailable";
    if (!known || status >= 500) logError("Veřejné API: požadavek selhal", known ? code : "unexpected_error", { request_id: requestId(request), status });
    response = Response.json({ error: known ? error.message : "Služba je dočasně nedostupná. Zopakujte požadavek se stejným Idempotency-Key.", code, request_id: requestId(request), ...(error instanceof PublicApiError || error instanceof InvoiceIssueError ? error.details : {}) }, { status });
    if (error instanceof ApiKeyError && error.retryAfter) response.headers.set("retry-after", String(error.retryAfter));
    if (status === 401) response.headers.set("www-authenticate", 'Bearer realm="Splatno API"');
  }
  // Shared application services may return localized validation responses.
  // Add the public contract's correlation/code fields at this HTTP boundary.
  if (!response.ok && response.headers.get("content-type")?.includes("application/json")) {
    const body = await response.clone().json() as Record<string, unknown>;
    response = Response.json({ ...body, code: body.code ?? `http_${response.status}`, request_id: requestId(request) }, { status: response.status, headers: response.headers });
  }
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("x-request-id", requestId(request));
  response.headers.set("x-content-type-options", "nosniff");
  if (identity) {
    if (identity.rateLimit) {
      response.headers.set("x-ratelimit-limit", String(identity.rateLimit.limit));
      response.headers.set("x-ratelimit-remaining", String(identity.rateLimit.remaining));
      response.headers.set("x-ratelimit-reset", identity.rateLimit.resetAt);
    }
    try { await recordApiKeyRequest(identity, { requestId: requestId(request), method: request.method, path: new URL(request.url).pathname, status: response.status, durationMs: Math.round(performance.now() - started) }); }
    catch { logError("Veřejné API: provozní záznam se nepodařilo uložit", "telemetry_unavailable", { request_id: requestId(request) }); }
  }
  return response;
}
export async function readApiJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new PublicApiError("Použijte Content-Type: application/json.", 415, "unsupported_media_type");
  const max = 65_536;
  const size = request.headers.get("content-length");
  if (size && (!/^\d+$/.test(size) || Number(size) > max)) throw new PublicApiError("Požadavek smí mít nejvýše 64 KiB.", 413, "payload_too_large");
  if (!request.body) throw new PublicApiError("Chybí JSON tělo požadavku.");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, body = "";
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > max) { await reader.cancel(); throw new PublicApiError("Požadavek smí mít nejvýše 64 KiB.", 413, "payload_too_large"); }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError("Neplatný JSON požadavek.");
  } finally { reader.releaseLock(); }
}
export function apiResourceId(id: string) { if (!API_UUID.test(id)) throw new PublicApiError("Neplatný identifikátor."); return id; }
export function apiRequireScope(identity: ApiContext, scope: ApiKeyScope) {
  if (!identity.scopes.includes(scope)) throw new PublicApiError("API klíč nemá oprávnění pro tuto operaci.", 403, "insufficient_scope");
}
export function apiQueryError(error: unknown) {
  if (error) throw new PublicApiError("Data se nepodařilo zpracovat. Zkuste to později.", 503, "database_unavailable");
}
export function apiNotFound(resource: string): never { throw new PublicApiError(`${resource} nebyl nalezen.`, 404, "not_found"); }
