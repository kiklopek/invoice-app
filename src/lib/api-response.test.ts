import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { apiError } from "./api-response";
import { requestId } from "./structured-log";

// Na tomhle helperu stojí chybové odpovědi všech uživatelských rout. Dosud ho
// hlídaly jen grepy nad zdrojákem -- ty potvrdí, že se volá, ale ne že vrací,
// co má. Tady se kontroluje skutečná odpověď.
//
// Smysl celé té konstrukce: uživatel při chybě 5xx dostane číslo, server pod
// týmž číslem zapíše důvod, a podpora ty dva spojí. Když se rozejdou, je to
// k ničemu -- proto se porovnávají proti sobě, ne jen na existenci.

const read = async (response: Response) => ({
  status: response.status,
  header: response.headers.get("x-request-id"),
  body: await response.json() as Record<string, unknown>,
});

describe("apiError", () => {
  it("vrací zadaný stav, hlášku i kód", async () => {
    const request = new Request("https://app.example/api/invoices");
    const { status, body } = await read(apiError(request, "Fakturu se nepodařilo načíst.", 500, "invoice_read_failed"));
    expect(status).toBe(500);
    expect(body.error).toBe("Fakturu se nepodařilo načíst.");
    expect(body.code).toBe("invoice_read_failed");
  });

  it("dá stejné id do těla i do hlavičky", async () => {
    // api-client.ts čte obojí -- tělo přednostně, hlavičku jako zálohu.
    // Kdyby se lišily, uživatel by nahlásil jiné číslo, než je v logu.
    const request = new Request("https://app.example/api/invoices");
    const { header, body } = await read(apiError(request, "Chyba", 500, "x"));
    expect(body.request_id).toBe(header);
    expect(String(body.request_id)).not.toHaveLength(0);
  });

  it("použije id, pod kterým chybu zapíše i logError", async () => {
    // Tohle je celé jádro dohledatelnosti: requestId() musí pro tutéž žádost
    // vrátit totéž, ať se na něj zeptá odpověď nebo log.
    const request = new Request("https://app.example/api/invoices");
    const { body } = await read(apiError(request, "Chyba", 500, "x"));
    expect(body.request_id).toBe(requestId(request));
  });

  it("přebírá identifikátor trasování z platformy, když ho žádost nese", async () => {
    const request = new Request("https://app.example/api/invoices", {
      headers: { "x-vercel-id": "fra1::abc123" },
    });
    const { body, header } = await read(apiError(request, "Chyba", 500, "x"));
    expect(body.request_id).toBe("fra1::abc123");
    expect(header).toBe("fra1::abc123");
  });

  it("doplňkové údaje nesmí přepsat hlášku, kód ani id", async () => {
    // Volající pošle details a omylem v nich použije vyhrazený klíč.
    const request = new Request("https://app.example/api/invoices");
    const { body } = await read(apiError(request, "Správná hláška", 500, "spravny_kod", {
      error: "podvržená hláška",
      code: "podvrzeny_kod",
      request_id: "podvrzene-id",
      retry_after: 30,
    }));
    expect(body.error).toBe("Správná hláška");
    expect(body.code).toBe("spravny_kod");
    expect(body.request_id).not.toBe("podvrzene-id");
    // Ostatní údaje ale projít mají.
    expect(body.retry_after).toBe(30);
  });

  it("zvládne i jiné stavy než 500", async () => {
    // Routy vracejí 502 (selhalo odesílání e-mailu) a 503 (služba není
    // připravená); helper nesmí být zadrátovaný na jedinou hodnotu.
    const request = new Request("https://app.example/api/invoices");
    for (const status of [500, 502, 503, 504]) {
      expect((await read(apiError(request, "Chyba", status, "x"))).status).toBe(status);
    }
  });
});
