import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { logError, logInfo, requestId } from "./structured-log";

// Jediná cesta, kterou se provozní chyby dostanou do logu. Když tenhle
// modul spadne nebo zahodí pole, přijdeme o jedinou stopu po tichém
// selhání cronu nebo párování plateb -- a právě proto se do něj v téhle
// fázi logování doplňovalo.

let logged: string[] = [];
let errored: string[] = [];

beforeEach(() => {
  logged = [];
  errored = [];
  vi.spyOn(console, "log").mockImplementation((value: string) => void logged.push(value));
  vi.spyOn(console, "error").mockImplementation((value: string) => void errored.push(value));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const parse = (line: string) => JSON.parse(line) as Record<string, unknown>;

describe("requestId", () => {
  it("prefers the platform id, so a log line matches the deployment trace", () => {
    const request = new Request("https://app.example", {
      headers: { "x-vercel-id": "fra1::abc", "x-request-id": "client-1" },
    });
    expect(requestId(request)).toBe("fra1::abc");
  });

  it("falls back to the client id when the platform sends none", () => {
    expect(requestId(new Request("https://app.example", { headers: { "x-request-id": "client-1" } }))).toBe("client-1");
  });

  it("vrací stejné id pro tutéž žádost, aby log šel spárovat s odpovědí", () => {
    // apiError() a logError() se ptají zvlášť. Kdyby pokaždé vzniklo jiné id,
    // uživatel by si opsal číslo, které v logu neexistuje.
    const request = new Request("https://app.example");
    expect(requestId(request)).toBe(requestId(request));
  });

  it("různé žádosti dostanou různé id", () => {
    expect(requestId(new Request("https://app.example")))
      .not.toBe(requestId(new Request("https://app.example")));
  });

  it("always returns something, so a log line is never unidentifiable", () => {
    const id = requestId(new Request("https://app.example"));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("logInfo a logError", () => {
  it("writes one parsable JSON line, not free text", () => {
    // Log se čte strojově; víceřádkový text by se v agregaci rozpadl.
    logInfo("Úklid doběhl", { removed: 3 });
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain("\n");
    expect(parse(logged[0])).toMatchObject({ level: "info", message: "Úklid doběhl", removed: 3 });
  });

  it("records the error message, not the object's toString", () => {
    logError("Párování selhalo", new Error("connection lost"));
    expect(parse(errored[0])).toMatchObject({ level: "error", message: "Párování selhalo", error: "connection lost" });
  });

  it("copes with anything thrown, not just Error instances", () => {
    // Supabase umí vyhodit obyčejný objekt; log kvůli tomu spadnout nesmí.
    for (const thrown of ["text", 42, null, undefined, { code: "23505" }]) {
      expect(() => logError("Chyba", thrown)).not.toThrow();
    }
    expect(errored).toHaveLength(5);
  });

  it("drops undefined context instead of writing null fields", () => {
    logInfo("Zpráva", { present: "ano", missing: undefined });
    const line = parse(logged[0]);
    expect(line.present).toBe("ano");
    expect("missing" in line).toBe(false);
  });

  it("kontext nemůže přepsat popis chyby ani úroveň", () => {
    // Volající omylem pošle "message" v kontextu. Kdyby vyhrál kontext,
    // v logu by zbyla nesouvisející věta a chyba by se nedala dohledat.
    logError("Párování selhalo", new Error("connection lost"), {
      message: "něco jiného",
      error: "taky jiné",
      level: "info",
    } as never);
    const line = parse(errored[0]);
    expect(line.message).toBe("Párování selhalo");
    expect(line.error).toBe("connection lost");
    expect(line.level).toBe("error");
  });

  it("timestamps every line in a sortable format", () => {
    logInfo("A");
    logError("B", new Error("x"));
    for (const line of [...logged, ...errored]) {
      expect(String(parse(line).timestamp)).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    }
  });

  it("sends errors to stderr and information to stdout", () => {
    // Jinak by se chyby ztratily mezi běžnými řádky.
    logInfo("A");
    logError("B", new Error("x"));
    expect(logged).toHaveLength(1);
    expect(errored).toHaveLength(1);
  });
});
