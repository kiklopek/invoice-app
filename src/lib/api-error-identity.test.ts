import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Když routa selže chybou 5xx, uživatel s tím nic nezmůže -- musí se ozvat.
// Aby to hlášení bylo k něčemu, potřebuje číslo, pod kterým se chyba najde
// v logu. apiError() vrací request_id v těle i v hlavičce x-request-id
// (api-client.ts obojí čte) a logError() zapíše tutéž chybu na server.
//
// Samotné číslo bez zápisu do logu je ale uživateli k ničemu, a zápis bez
// čísla se nedá spárovat. Proto se hlídá obojí najednou.
//
// Validační 4xx se schválně nehlídají: tam si uživatel poradí sám a odkaz
// na podporu by jen překážel.

const API = join(process.cwd(), "src", "app", "api");

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...routeFiles(path));
    else if (entry === "route.ts") found.push(path);
  }
  return found;
}

const relative = (path: string) => path.slice(process.cwd().length + 1);

// Jméno, pod kterým je logError v daném souboru dostupné. Jedna routa má
// vlastní lokální proměnnou logError, takže import musí být pod aliasem --
// test si ho proto odvodí, místo aby spoléhal na jedno jméno.
function logFunctionName(source: string) {
  const aliased = /import\s*\{[^}]*\blogError\s+as\s+(\w+)/.exec(source);
  return aliased ? aliased[1] : "logError";
}

// Routy, které už jsou převedené. Seznam smí jen růst -- když z něj něco
// vypadne, je to regrese a tenhle test ji ohlásí.
const CONVERTED = [
  "src/app/api/invoices/[id]/route.ts",
  "src/app/api/payments/route.ts",
  "src/app/api/payments/imports/[id]/route.ts",
  "src/app/api/customers/route.ts",
  "src/app/api/customers/[id]/route.ts",
  "src/app/api/reports/route.ts",
  "src/app/api/dashboard/route.ts",
  "src/app/api/invoices/route.ts",
  "src/app/api/settings/reminder-policies/route.ts",
  "src/app/api/settings/email-suppressions/route.ts",
  "src/app/api/invoices/[id]/activity/route.ts",
  "src/app/api/invoices/[id]/page-data/route.ts",
  "src/app/api/invoices/[id]/reminders/route.ts",
  "src/app/api/reminders/page-data/route.ts",
  "src/app/api/settings/page-data/route.ts",
  "src/app/api/payments/audit/route.ts",
  "src/app/api/settings/company/route.ts",
  "src/app/api/settings/reminders/route.ts",
  "src/app/api/customers/search/route.ts",
  "src/app/api/payments/invoice-candidates/route.ts",
  "src/app/api/payments/imports/route.ts",
  "src/app/api/invoices/[id]/pdf/route.ts",
  "src/app/api/invoices/[id]/document/route.ts",
  "src/app/api/reminders/route.ts",
  "src/app/api/settings/members/route.ts",
  "src/app/api/invoices/upload/route.ts",
  "src/app/api/invoices/upload/verify/route.ts",
  "src/app/api/invoices/reminder-policy-preference/route.ts",
  "src/app/api/settings/reminders/test/route.ts",
  "src/app/api/invoices/[id]/send/route.ts",
  "src/app/api/invoices/[id]/reminders/[reminderId]/retry/route.ts",
  "src/app/api/invoices/[id]/assignable-payments/route.ts",
];

describe("dohledatelnost chyb 5xx", () => {
  it("převedené routy nevracejí holou chybu 5xx bez request_id", () => {
    for (const path of CONVERTED) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      // Holý NextResponse.json se status 500 znamená odpověď bez request_id.
      expect(source, `${path} vrací 5xx mimo apiError()`).not.toMatch(/status:\s*5\d\d/);
      expect(source, `${path} nepoužívá apiError()`).toContain("apiError(");
      expect(source, `${path} chybu nikam nezapisuje`).toContain(`${logFunctionName(source)}(`);
    }
  });

  it("každé apiError() v nich má vedle sebe zápis do logu", () => {
    for (const path of CONVERTED) {
      // Komentáře se odstraňují, jinak by se počítaly i zmínky v nich.
      const source = readFileSync(join(process.cwd(), path), "utf8")
        .split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
      const errors = (source.match(/apiError\(/g) ?? []).length;
      const logs = (source.match(new RegExp(`${logFunctionName(source)}\\(`, "g")) ?? []).length;
      expect(logs, `${path}: ${errors}x apiError, ale jen ${logs}x logError`).toBeGreaterThanOrEqual(errors);
    }
  });

  // Cron a webhook vědomě mimo: jejich odpověď nečte uživatel, ale platforma,
  // a stavový kód řídí opakování běhu. Zápis do logu tam přibyl, odpovědi
  // zůstaly nedotčené, takže se retry chování nezměnilo.
  it("cron a webhook svoje chyby zapisují, i když odpověď nemění", () => {
    for (const path of [
      "src/app/api/cron/check-due/route.ts",
      "src/app/api/cron/reconcile-payments/route.ts",
      "src/app/api/webhooks/resend/route.ts",
    ]) {
      expect(readFileSync(join(process.cwd(), path), "utf8"), path).toContain("logError(");
    }
  });

  it("eviduje, kolik rout ještě převedených není", () => {
    // Tenhle test nehlídá kvalitu, ale rozsah zbývající práce. Číslo smí jen
    // klesat; když někdo přidá routu s holou 5xx odpovědí, test to ohlásí.
    const remaining = routeFiles(API)
      .filter(path => /status:\s*5\d\d/.test(readFileSync(path, "utf8")))
      .map(relative);
    expect(remaining).not.toContain("src/app/api/invoices/[id]/route.ts");
    expect(remaining.length, `zbývá převést:\n${remaining.join("\n")}`).toBeLessThanOrEqual(3);
  });
});
