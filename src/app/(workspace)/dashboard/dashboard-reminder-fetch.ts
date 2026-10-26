import { apiFetch, ApiRequestError } from "@/lib/api-client";

// Only these read requests get one bounded retry. In development a cold
// Route Handler can exceed the first request's deadline while compiling.
export async function fetchReminderRead<T>(key: string): Promise<T> {
  try {
    return await apiFetch<T>(key, { headers: { accept: "application/json" } });
  } catch (error) {
    if (!(error instanceof ApiRequestError) || ![0, 408, 502, 503, 504].includes(error.status)) throw error;
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
    return apiFetch<T>(key, { headers: { accept: "application/json" } });
  }
}

export function reminderReadError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "Ověření není dostupné.";
  if (error.code === "timeout") return "Server odpovídá příliš dlouho.";
  if (error.code === "network_error") return "Server není dostupný.";
  return `${error.message} (${error.status}${error.requestId ? ` · ${error.requestId}` : ""})`;
}
