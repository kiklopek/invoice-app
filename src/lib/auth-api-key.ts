import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase-server";
import { isApiKeyScope, type ApiKeyScope } from "@/lib/api-key-policy";

export type { ApiKeyScope } from "@/lib/api-key-policy";

export class ApiKeyError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string, public readonly retryAfter?: number) {
    super(message);
    this.name = "ApiKeyError";
  }
}

export function generateApiKey() {
  const key = `spl_${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(4, 12), hash: createHash("sha256").update(key).digest("hex") };
}

export type ApiKeyIdentity = {
  organizationId: string;
  keyId: string;
  actingUserId: string;
  scopes: ApiKeyScope[];
  service: ReturnType<typeof createServiceClient>;
  membership: { id: string; organization_id: string; email: string; role: "admin" };
  user: { id: string; email: string };
  rateLimit: { limit: number; remaining: number; resetAt: string };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getApiKeyIdentity(request: Request, scope: ApiKeyScope): Promise<ApiKeyIdentity> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer (spl_[A-Za-z0-9_-]{43})$/i.exec(authorization);
  if (!match) throw new ApiKeyError("Chybí platný API klíč.", 401, "invalid_api_key");
  const hash = createHash("sha256").update(match[1]).digest("hex");
  const service = createServiceClient();
  // PostgreSQL checks the current owner membership and consumes the key's rate
  // limit under a row lock shared with revocation. The raw secret stays here.
  const { data, error } = await service.rpc("authenticate_organization_api_key", { target_hash: hash, required_scope: scope });
  if (error) throw new ApiKeyError("Ověření API klíče je dočasně nedostupné.", 503, "api_auth_unavailable");
  const result = data as Record<string, unknown> | null;
  if (result?.status === "forbidden") throw new ApiKeyError("API klíč nemá požadované oprávnění.", 403, "insufficient_scope");
  if (result?.status === "rate_limited") {
    const retry = typeof result.retry_after === "number" && Number.isFinite(result.retry_after) ? Math.max(1, Math.ceil(result.retry_after)) : 60;
    throw new ApiKeyError("Byl překročen limit API požadavků. Zkuste to později.", 429, "rate_limited", retry);
  }
  if (result?.status !== "ok") throw new ApiKeyError("API klíč není platný nebo už nemá přístup k firmě.", 401, "invalid_api_key");
  const validId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
  if (!validId(result.organization_id) || !validId(result.key_id) || !validId(result.acting_user_id) || !validId(result.membership_id) ||
      typeof result.email !== "string" || !Array.isArray(result.scopes) || !result.scopes.every(isApiKeyScope) || !result.scopes.includes(scope) ||
      typeof result.limit !== "number" || typeof result.remaining !== "number" || typeof result.reset_at !== "string") {
    throw new ApiKeyError("Ověření API klíče je dočasně nedostupné.", 503, "api_auth_unavailable");
  }
  return {
    organizationId: result.organization_id, keyId: result.key_id, actingUserId: result.acting_user_id,
    scopes: result.scopes, service,
    membership: { id: result.membership_id, organization_id: result.organization_id, email: result.email, role: "admin" },
    user: { id: result.acting_user_id, email: result.email },
    rateLimit: { limit: result.limit, remaining: result.remaining, resetAt: result.reset_at },
  };
}

export async function recordApiKeyRequest(identity: ApiKeyIdentity, entry: {
  requestId: string; method: string; path: string; status: number; durationMs: number;
}) {
  const path = entry.path.split("?")[0].slice(0, 200);
  if (!path.startsWith("/api/v1/")) throw new Error("Invalid API audit path");
  const { error } = await identity.service.from("api_key_requests").insert({
    organization_id: identity.organizationId, key_id: identity.keyId,
    request_id: entry.requestId.slice(0, 128), method: entry.method.toUpperCase(), path,
    status: entry.status, duration_ms: Math.max(0, Math.ceil(entry.durationMs)),
  });
  if (error) throw new Error("API request audit could not be saved");
}
