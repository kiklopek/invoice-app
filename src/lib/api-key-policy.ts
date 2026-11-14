export const API_KEY_SCOPES = [
  "invoices:read", "invoices:write", "invoices:send", "customers:read", "customers:write",
  "payments:read", "payments:write", "reminders:read", "reminders:write", "reports:read",
  "company:read", "events:read",
] as const;

export type ApiKeyScope = typeof API_KEY_SCOPES[number];

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  "invoices:read": "Čtení faktur a PDF",
  "invoices:write": "Vystavování faktur",
  "invoices:send": "Odesílání faktur e-mailem",
  "customers:read": "Čtení zákazníků",
  "customers:write": "Správa zákazníků",
  "payments:read": "Čtení plateb",
  "payments:write": "Potvrzování úhrad",
  "reminders:read": "Čtení upomínek",
  "reminders:write": "Pozastavení a obnovení upomínek",
  "reports:read": "Čtení reportů",
  "company:read": "Čtení údajů firmy",
  "events:read": "Čtení událostí faktur",
};

export type ApiKeySummary = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: ApiKeyScope[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === "string" && (API_KEY_SCOPES as readonly string[]).includes(value);
}
