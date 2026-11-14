import { getRequestIdentity, type RequestIdentity } from "@/lib/auth";
import { generateApiKey } from "@/lib/auth-api-key";
import { isApiKeyScope } from "@/lib/api-key-policy";
import { apiError } from "@/lib/api-response";
import { isSameOriginMutation } from "@/lib/request-security";
import { logError } from "@/lib/structured-log";

const COLUMNS = "id,name,key_prefix,scopes,created_at,last_used_at,expires_at,revoked_at";
const JSON_HEADERS = { "cache-control": "private, no-store" };

function administrator(request: Request, identity: RequestIdentity | null) {
  if (!identity) return apiError(request, "Nejste přihlášený uživatel.", 401, "unauthorized");
  if (identity.membership.role !== "admin" || identity.support) return apiError(request, "API klíče spravuje administrátor firmy.", 403, "forbidden");
  return null;
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 8192) return null;
  try {
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch { return null; }
}

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  const denied = administrator(request, identity);
  if (denied || !identity) return denied!;
  const { data, error } = await identity.service.from("organization_api_keys").select(COLUMNS)
    .eq("organization_id", identity.membership.organization_id).order("created_at", { ascending: false });
  if (error) {
    logError("API klíče se nepodařilo načíst", error);
    return apiError(request, "API klíče se nepodařilo načíst.", 503, "api_keys_unavailable");
  }
  return Response.json({ keys: data ?? [] }, { headers: JSON_HEADERS });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  const identity = await getRequestIdentity();
  const denied = administrator(request, identity);
  if (denied || !identity) return denied!;
  const body = await readBody(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const scopes = body?.scopes;
  const rawExpiration = body?.expires_at;
  const expiresAt = rawExpiration == null ? null : typeof rawExpiration === "string" ? Date.parse(rawExpiration) : NaN;
  if (!name || name.length > 80 || !Array.isArray(scopes) || !scopes.length || scopes.length > 20 || !scopes.every(isApiKeyScope) ||
      (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now()))) {
    return apiError(request, "Vyplňte název, platná oprávnění a budoucí datum platnosti klíče.", 400, "invalid_api_key_settings");
  }
  const generated = generateApiKey();
  const { data, error } = await identity.service.rpc("create_organization_api_key", {
    target_org: identity.membership.organization_id, actor_user: identity.user.id,
    key_name: name, display_prefix: generated.prefix, secret_hash: generated.hash,
    granted_scopes: [...new Set(scopes)], expiration_time: expiresAt === null ? null : new Date(expiresAt).toISOString(),
  });
  if (error?.code === "42501") return apiError(request, "API klíče spravuje administrátor firmy.", 403, "forbidden");
  if (error || !data) {
    logError("API klíč se nepodařilo vytvořit", error);
    return apiError(request, "API klíč se nepodařilo vytvořit.", 503, "api_key_creation_failed");
  }
  return Response.json({ key: generated.key, api_key: data }, { status: 201, headers: JSON_HEADERS });
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  const identity = await getRequestIdentity();
  const denied = administrator(request, identity);
  if (denied || !identity) return denied!;
  const body = await readBody(request);
  if (typeof body?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) {
    return apiError(request, "Vyberte API klíč.", 400, "invalid_api_key_id");
  }
  const { data, error } = await identity.service.rpc("revoke_organization_api_key", {
    target_org: identity.membership.organization_id, actor_user: identity.user.id, target_key: body.id,
  });
  if (error?.code === "42501") return apiError(request, "API klíče spravuje administrátor firmy.", 403, "forbidden");
  if (error?.code === "P0002") return apiError(request, "API klíč nebyl nalezen.", 404, "api_key_not_found");
  if (error || data !== true) {
    logError("API klíč se nepodařilo zrušit", error);
    return apiError(request, "API klíč se nepodařilo zrušit.", 503, "api_key_revocation_failed");
  }
  return Response.json({ revoked: true }, { headers: JSON_HEADERS });
}
