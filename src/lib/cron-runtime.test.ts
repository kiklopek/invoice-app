import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const CRON_DIR = "src/app/api/cron";

const cronRoutes = () =>
  readdirSync(join(process.cwd(), CRON_DIR), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

const numberOf = (source: string, name: string) => {
  const match = new RegExp(`${name}\\s*=\\s*([0-9_]+)`).exec(source);
  return match ? Number(match[1].replace(/_/g, "")) : null;
};

describe("cron runtime budgets", () => {
  // Kazda cron routa musi byt ve vercel.json, jinak ji nic nespousti a tise
  // nebezi. A kazda musi vyslovne rict svuj maxDuration -- vychozi limit na
  // Vercelu je 10-15 s, coz je pod rozpoctem, se kterym tyhle handlery
  // pracuji. Az potud to hlida struktura, ne chovani.
  it("registers every cron route in vercel.json", () => {
    const scheduled = new Set(
      (JSON.parse(read("vercel.json")).crons as { path: string }[]).map(cron => cron.path),
    );
    for (const route of cronRoutes()) {
      expect(scheduled.has(`/api/cron/${route}`)).toBe(true);
    }
  });

  it("declares maxDuration on every cron route", () => {
    for (const route of cronRoutes()) {
      expect(read(`${CRON_DIR}/${route}/route.ts`)).toMatch(/export const maxDuration = \d+/);
    }
  });

  // Tohle je ta chyba, kvuli ktere test vznikl: worker si uvnitr povoloval
  // 45 s, zatimco funkce sama mela vychozi limit 10-15 s. Utnula ho uprostred
  // lease okna a nikdo se to nedozvedel. Vnitrni rozpocet proto musi mit
  // rezervu POD deklarovanym maxDuration, ne nad nim.
  it("keeps the reminder worker budget safely under its own function limit", () => {
    const source = read(`${CRON_DIR}/check-due/route.ts`);
    const maxDuration = numberOf(source, "export const maxDuration");
    const workerBudget = numberOf(source, "WORKER_MAX_RUNTIME_MS");
    expect(maxDuration).not.toBeNull();
    expect(workerBudget).not.toBeNull();
    expect(workerBudget!).toBeLessThanOrEqual(maxDuration! * 1000 - 10_000);
  });

  // Hobby povoluje nejvys 60 s na funkci a nejvys dve cron ulohy. Drzime se
  // pod obojim, aby nasazeni nezaviselo na tom, jaky plan je zrovna aktivni.
  it("stays inside the limits of the most restrictive Vercel plan", () => {
    for (const route of cronRoutes()) {
      expect(numberOf(read(`${CRON_DIR}/${route}/route.ts`), "export const maxDuration")!).toBeLessThanOrEqual(60);
    }
    expect((JSON.parse(read("vercel.json")).crons as unknown[]).length).toBeLessThanOrEqual(2);
  });
});

describe("cron handler isolation", () => {
  // Uklid expirovanych OCR souboru driv pri kazde chybe volal
  // finishRuns("failed") a shodil CELY denni beh upominek kvuli problemu,
  // ktery s upominkami nesouvisi -- ten den neodesla ani jedna. Samostatnou
  // cron routu z toho udelat nejde (Hobby povoluje dve a obe jsou obsazene),
  // takze invariant je jiny: uklid je izolovany a jeho selhani je nefatalni.
  it("never lets upload cleanup fail the reminder run", () => {
    const source = read(`${CRON_DIR}/check-due/route.ts`);
    const start = source.indexOf("async function cleanupExpiredUploads");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("\ntype QueueJob", start));
    // Uvnitr uklidu nesmi byt zadna cesta, ktera ukonci beh jako failed.
    expect(body).not.toContain("finishRuns");
    expect(body).not.toContain("NextResponse");
    // A kazda jeho chybova vetev musi nechat stopu, jinak je to tiche selhani.
    expect(body).toContain("logError");
    expect(body).toContain("try {");
    expect(body).toContain("catch (cause)");
  });
});

describe("cron failure visibility", () => {
  // Bezi jednou denne. Tichá chyba je tichá po tydny -- driv se chyba RPC
  // zahodila uplne a nezbyl po ni zadny zaznam.
  it("logs reconcile failures instead of swallowing them", () => {
    const source = read(`${CRON_DIR}/reconcile-payments/route.ts`);
    expect(source).toContain("logError");
  });
});

describe("Hobby plan cron compliance", () => {
  // Skutečný incident (22. 9.): vercel.json měl reconcile-payments na
  // "*/5 * * * *" (každých 5 minut). Hobby plán povoluje cron jen jednou
  // denně -- Vercel takový plán odmítne nasadit ("Hobby accounts are
  // limited to cron jobs that run once per day"). Nešlo o jedno selhání:
  // KAŽDÝ deploy od chvíle, kdy se ta routa objevila (12 commitů), tise
  // selhal a produkce zůstala vzadu, aniž by si toho kdokoli všiml --
  // GitHub check hlásil selhání, ale nikdo se na něj nepodíval.
  //
  // Test hlídá tvar výrazu, ne konkrétní čas: pole minuta a hodina musí být
  // pevná čísla, ne "*", "*/5", rozsah nebo seznam -- cokoli jiného znamená
  // víc než jeden běh za den.
  const runsAtMostOncePerDay = (expression: string) => {
    const [minute, hour] = expression.trim().split(/\s+/);
    const isFixed = (field: string | undefined) => field !== undefined && /^\d+$/.test(field);
    return isFixed(minute) && isFixed(hour);
  };

  it("odmítne známý špatný výraz, aby bylo jasné, že test skutečně měří", () => {
    expect(runsAtMostOncePerDay("*/5 * * * *")).toBe(false);
  });

  it("každý naplánovaný cron v vercel.json běží nejvýš jednou denně", () => {
    const crons = JSON.parse(read("vercel.json")).crons as { path: string; schedule: string }[];
    expect(crons.length).toBeGreaterThan(0);
    for (const cron of crons) {
      expect(runsAtMostOncePerDay(cron.schedule), `${cron.path}: "${cron.schedule}" běží víckrát než jednou denně -- Hobby plán takový deploy odmítne`).toBe(true);
    }
  });
});
