export type ApiErrorPayload = { error?: string; code?: string; request_id?: string };

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "request_failed",
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiFetch<T>(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => null) as T | ApiErrorPayload | null;
    if (response.status === 401 && window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
    if (!response.ok) {
      const error = payload as ApiErrorPayload | null;
      throw new ApiRequestError(
        error?.error || "Požadavek se nepodařilo dokončit.",
        response.status,
        error?.code,
        error?.request_id || response.headers.get("x-request-id") || undefined,
      );
    }
    if (payload === null) throw new ApiRequestError("Server vrátil neplatnou odpověď.", response.status, "invalid_response");
    return payload as T;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (init.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    if (controller.signal.aborted) throw new ApiRequestError("Požadavek trval příliš dlouho. Zkuste to znovu.", 408, "timeout");
    throw new ApiRequestError("Server není dostupný. Zkontrolujte připojení a zkuste to znovu.", 0, "network_error");
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}
