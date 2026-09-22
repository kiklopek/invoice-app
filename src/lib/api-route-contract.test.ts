import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Bezpečnostní řetězec (CSRF -> identita -> role) je podle auditu to nejlepší,
// co v kódu je, a drží ho 46 rout ručně. Stačí jedna nová routa, kde na něj
// někdo zapomene, a díra je tichá. Tenhle test proto neověřuje jednu routu,
// ale to, že z pravidla neexistují nezdokumentované výjimky.

const API_DIR = "src/app/api";

function routeFiles(dir = API_DIR): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const routePath = (file: string) => file.replace(`${API_DIR}`, "/api").replace("/route.ts", "");

const MUTATING = /export async function (POST|PUT|PATCH|DELETE)/;

// Výjimky musí být pojmenované a zdůvodněné. Prázdný seznam by znamenal,
// že test nic neví o realitě; seznam bez důvodů by se rozrostl bez povšimnutí.
const CSRF_EXEMPT: Record<string, string> = {
  "/api/cron/check-due": "Cron i ruční spuštění; POST větev origin kontroluje sama.",
  "/api/cron/reconcile-payments": "Jen GET, spouští Vercel cron s Bearer tokenem.",
  "/api/webhooks/resend": "Příchozí webhook od Resendu, ověřený podpisem Svix.",
  "/api/invoices/upload/verify": "Volá se hned po uploadu ve stejném toku.",
};

// Vrácení zprávy odchycené výjimky je v pořádku tam, kde ty výjimky vyhazuje
// náš vlastní kód s českým textem určeným uživateli.
const RAW_MESSAGE_EXEMPT: Record<string, string> = {
  "/api/payments/imports": "Výjimky sem hází vlastní GPC parser s českými hláškami o konkrétním řádku výpisu.",
};

const IDENTITY_EXEMPT: Record<string, string> = {
  "/api/auth/logout": "Odhlášení musí projít i s už neplatnou identitou.",
  "/api/auth/registration-access": "Veřejné, chráněné rate limitem na IP i e-mail.",
  "/api/auth/password-recovery": "Veřejné, odpovídá neutrálně, aby nešlo zjistit existenci účtu.",
  "/api/cron/check-due": "Cron cesta se autorizuje sdíleným tajemstvím.",
  "/api/cron/reconcile-payments": "Cron cesta se autorizuje sdíleným tajemstvím v hlavičce Authorization.",
  "/api/webhooks/resend": "Příchozí webhook se autorizuje podpisem Svix, ne identitou uživatele.",
  "/api/health": "Diagnostika bez citlivých dat.",
};

describe("smlouva API rout", () => {
  const files = routeFiles();

  it("finds every route, so the check cannot silently cover nothing", () => {
    expect(files.length).toBeGreaterThanOrEqual(40);
  });

  it("checks the request origin before any mutation", () => {
    const offenders = files.filter(file => {
      const source = read(file);
      if (!MUTATING.test(source)) return false;
      if (routePath(file) in CSRF_EXEMPT) return false;
      return !source.includes("isSameOriginMutation");
    });
    expect(offenders.map(routePath)).toEqual([]);
  });

  it("resolves the caller's identity before touching data", () => {
    const offenders = files.filter(file => {
      const source = read(file);
      if (routePath(file) in IDENTITY_EXEMPT) return false;
      return !source.includes("getRequestIdentity");
    });
    expect(offenders.map(routePath)).toEqual([]);
  });

  it("keeps every cron route behind the shared secret", () => {
    for (const file of files.filter(file => routePath(file).startsWith("/api/cron/"))) {
      expect(read(file), routePath(file)).toContain("CRON_SECRET");
    }
  });

  it("never returns an unrecognised error's message to the caller", () => {
    // Uživateli patří česká věta, technický detail do logu. Předávat dál
    // `error.message` z NEZNÁMÉ chyby znamená vypustit ven vnitřnosti
    // databáze. Zprávy vlastních typů (PageDataError) jsou naopak psané
    // pro uživatele, takže projít smí -- proto se kontroluje kontext,
    // ne holý výskyt.
    const offenders = files.filter(file => {
      const source = read(file);
      // Ukotveno na pole `error:` ODPOVĚDI. Stejná konstrukce se totiž
      // legitimně používá pro logování a pro zápis do databáze --
      // předchozí, širší verze tohohle testu kvůli tomu hlásila tři routy,
      // které nic ven neposílají.
      if (routePath(file) in RAW_MESSAGE_EXEMPT) return false;
      const flat = source.replace(/\s+/g, " ");
      return [...flat.matchAll(/error:/g)].some(match =>
        /^error:[^}]{0,120}instanceof Error \? \w+\.message/.test(flat.slice(match.index!, match.index! + 160)),
      );
    });
    expect(offenders.map(routePath)).toEqual([]);
  });

  it("documents why each exemption exists", () => {
    // Výjimka bez důvodu je jen díra, na kterou si někdo zvykl.
    for (const reason of [...Object.values(CSRF_EXEMPT), ...Object.values(IDENTITY_EXEMPT), ...Object.values(RAW_MESSAGE_EXEMPT)]) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it("lists no exemption for a route that no longer exists", () => {
    const known = new Set(files.map(routePath));
    for (const path of [...Object.keys(CSRF_EXEMPT), ...Object.keys(IDENTITY_EXEMPT), ...Object.keys(RAW_MESSAGE_EXEMPT)]) {
      expect(known.has(path), `výjimka pro neexistující routu ${path}`).toBe(true);
    }
  });
});
