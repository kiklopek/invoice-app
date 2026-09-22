import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, apiFetch } from "./api-client";

// apiFetch je jediná cesta, kterou většina klientů mluví se serverem, a
// neměla test. Rozhoduje přitom o třech věcech, kde chyba bolí: kdy je
// bezpečné požadavek zopakovat, kam uživatele poslat po vypršení session,
// a jestli se k němu dostane identifikátor požadavku pro podporu.
//
// Projekt nemá DOM prostředí, takže se `window` a `fetch` nahrazují
// minimálním stubem místo zavádění jsdom kvůli jednomu souboru.

let responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }> = [];
let requests: Array<{ url: string; init: RequestInit }> = [];
let assigned: string[] = [];

function respond() {
  const next = responses.shift() ?? { status: 200, body: {} };
  return {
    ok: next.status >= 200 && next.status < 300,
    status: next.status,
    json: async () => next.body,
    headers: new Headers(next.headers ?? {}),
  } as unknown as Response;
}

beforeEach(() => {
  responses = [];
  requests = [];
  assigned = [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init: RequestInit) => {
    requests.push({ url: String(url), init });
    return respond();
  });
  vi.stubGlobal("window", {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
    location: {
      pathname: "/invoices",
      search: "?q=Novák",
      assign: (url: string) => assigned.push(url),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opakování požadavku po 401", () => {
  // Vypršelý token se obnoví na pozadí, takže první 401 nemusí znamenat
  // odhlášení. Opakovat se ale smí jen to, co opakováním nic nezkazí.
  it("retries a GET once, because reading twice is harmless", async () => {
    responses = [{ status: 401, body: {} }, { status: 200, body: { ok: true } }];
    await expect(apiFetch("/api/invoices")).resolves.toEqual({ ok: true });
    expect(requests).toHaveLength(2);
  });

  it("never retries a POST without an idempotency key", async () => {
    // Zopakovaný zápis bez klíče by mohl založit fakturu nebo platbu dvakrát.
    responses = [{ status: 401, body: { error: "Nejste přihlášený uživatel." } }];
    await expect(apiFetch("/api/invoices", { method: "POST" })).rejects.toThrow(ApiRequestError);
    expect(requests).toHaveLength(1);
  });

  it("retries a POST that carries an idempotency key", async () => {
    responses = [{ status: 401, body: {} }, { status: 200, body: { ok: true } }];
    await apiFetch("/api/invoices", {
      method: "POST",
      headers: { "x-idempotency-key": "invoice-1" },
    });
    expect(requests).toHaveLength(2);
  });
});

describe("vypršená session", () => {
  it("sends the user to login and remembers where they were", async () => {
    responses = [{ status: 401, body: {} }, { status: 401, body: {} }];
    await expect(apiFetch("/api/invoices")).rejects.toThrow();
    expect(assigned[0]).toBe("/login?returnTo=%2Finvoices%3Fq%3DNov%C3%A1k");
  });

  it("does not bounce a user who is already on the login page", async () => {
    (globalThis as { window: { location: { pathname: string } } }).window.location.pathname = "/login";
    responses = [{ status: 401, body: {} }, { status: 401, body: {} }];
    await expect(apiFetch("/api/auth/access", { method: "POST" })).rejects.toThrow();
    expect(assigned).toEqual([]);
  });
});

describe("tvar chyby pro uživatele", () => {
  it("prefers the server's Czech message over a generic one", async () => {
    responses = [{ status: 409, body: { error: "Fakturu s tímto číslem už evidujete.", code: "duplicate" } }];
    await expect(apiFetch("/api/invoices", { method: "POST" })).rejects.toMatchObject({
      message: "Fakturu s tímto číslem už evidujete.",
      status: 409,
      code: "duplicate",
    });
  });

  it("falls back to a Czech sentence when the server sends nothing usable", async () => {
    responses = [{ status: 500, body: null }];
    await expect(apiFetch("/api/invoices")).rejects.toThrow(/nepodařilo dokončit/);
  });

  it("carries the request id so it can be quoted to support", async () => {
    responses = [{ status: 500, body: { error: "Chyba", request_id: "req-123" } }];
    await expect(apiFetch("/api/invoices")).rejects.toMatchObject({ requestId: "req-123" });
  });

  it("falls back to the response header when the body has no id", async () => {
    responses = [{ status: 500, body: { error: "Chyba" }, headers: { "x-request-id": "hdr-456" } }];
    await expect(apiFetch("/api/invoices")).rejects.toMatchObject({ requestId: "hdr-456" });
  });

  it("treats an unparsable success body as an error, not as empty data", async () => {
    // Vrátit `null` do komponenty by se projevilo až o několik řádků dál
    // jako nesouvisející pád.
    responses = [{ status: 200, body: null }];
    await expect(apiFetch("/api/invoices")).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("síť a čas", () => {
  it("explains a timeout in Czech instead of leaking AbortError", async () => {
    // Stub musí respektovat AbortSignal stejně jako skutečný fetch --
    // jinak by test měřil chování, které v prohlížeči nenastane.
    vi.stubGlobal("fetch", (_url: RequestInfo | URL, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
    );
    await expect(apiFetch("/api/invoices", {}, 10)).rejects.toMatchObject({ code: "timeout", status: 408 });
  });

  it("explains an unreachable server in Czech", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(apiFetch("/api/invoices")).rejects.toMatchObject({ code: "network_error", status: 0 });
  });
});
