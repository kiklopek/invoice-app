import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAresCache, lookupAresSubject } from "./ares";

const ICO = "46692011";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => clearAresCache());

describe("ARES klient (fetch je vždy podvržený, žádný skutečný dotaz)", () => {
  it("vrátí název, DIČ a adresu subjektu", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ico: ICO, obchodniJmeno: "TIMBER & PULP a.s.", dic: "CZ46692011", sidlo: { textovaAdresa: "Dubová 38, 664 91 Ivančice" } }));
    await expect(lookupAresSubject(ICO, { fetchImpl })).resolves.toEqual({
      status: "found",
      cached: false,
      subject: { ico: ICO, name: "TIMBER & PULP a.s.", dic: "CZ46692011", address: "Dubová 38, 664 91 Ivančice" },
    });
    expect(fetchImpl).toHaveBeenCalledWith(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ICO}`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("druhý dotaz na stejné IČO jde z paměti", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ico: ICO, obchodniJmeno: "TIMBER & PULP a.s." }));
    await lookupAresSubject(ICO, { fetchImpl });
    const second = await lookupAresSubject(ICO, { fetchImpl });
    expect(second).toMatchObject({ status: "found", cached: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("404 znamená, že subjekt neexistuje", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    await expect(lookupAresSubject(ICO, { fetchImpl })).resolves.toEqual({ status: "not_found" });
  });

  it("neplatné IČO se do ARES vůbec neposílá", async () => {
    const fetchImpl = vi.fn();
    await expect(lookupAresSubject("12345678", { fetchImpl })).resolves.toEqual({ status: "invalid_ico" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("timeout, 5xx i nesmyslná odpověď jsou 'nedostupné', neblokují a neukládají se do cache", async () => {
    const hanging = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    await expect(lookupAresSubject(ICO, { fetchImpl: hanging, timeoutMs: 20 })).resolves.toEqual({ status: "unavailable", reason: "timeout" });
    await expect(lookupAresSubject(ICO, { fetchImpl: vi.fn(async () => new Response("", { status: 503 })) })).resolves.toEqual({ status: "unavailable", reason: "http_error" });
    await expect(lookupAresSubject(ICO, { fetchImpl: vi.fn(async () => jsonResponse({ ico: "99999999", obchodniJmeno: "Jiná" })) })).resolves.toEqual({ status: "unavailable", reason: "invalid_response" });
    const ok = vi.fn(async () => jsonResponse({ ico: ICO, obchodniJmeno: "TIMBER & PULP a.s." }));
    await expect(lookupAresSubject(ICO, { fetchImpl: ok })).resolves.toMatchObject({ status: "found", cached: false });
  });
});
