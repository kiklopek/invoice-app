import { describe, expect, it } from "vitest";
import { proposeStatement } from "./statement-proposals";
import { goldenInvoices, goldenKnownAccounts, goldenOwnAccounts, goldenRows, goldenSettled } from "./__fixtures__/statement-golden";
import type { AutoBookingPolicy } from "./statement-assignment";

/**
 * Kontrolní sada výpisů (plán párování, krok P0). Tabulka je přesné očekávání
 * pro každý řádek; změna párovací logiky se tu musí projevit vědomě.
 * Formát: [druh návrhu, jistota, navržené faktury].
 */
type Expected = [kind: string | null, confidence: string | null, ids: string[]];

const vsAndName: Record<string, Expected> = {
  "vs-exact": ["exact", "safe", ["vs-exact"]],
  // Úvodní nuly ve VS nevadí.
  "vs-zeros": ["exact", "safe", ["vs-zeros"]],
  // VS = číslo faktury bez lomítka („2026/045“ -> 2026045).
  "vs-is-number": ["exact", "safe", ["2026/045"]],
  // Stejný VS na dvou fakturách: nikdy jistá shoda.
  "dup-vs": ["ambiguous", "review", ["dup-vs-a", "dup-vs-b"]],
  // Potvrzený účet plátce a přesná částka.
  account: ["exact", "safe", ["account"]],
  // Částečná úhrada i přeplatek jen ke kontrole.
  partial: ["ambiguous", "review", ["partial"]],
  over: ["ambiguous", "review", ["over"]],
  // ZNÁMÝ NEDOSTATEK (opraví krok P1): platba od Thety za dvě její faktury
  // (600 + 400) dostane návrh faktury jiné firmy jen podle částky.
  combo: ["exact", "review", ["over"]],
  // Haléřový rozdíl je dnes jen částečná úhrada (změní krok P4: ±1 Kč).
  rounding: ["ambiguous", "review", ["rounding"]],
  // Jiná měna se nikdy nepřiřadí.
  "eur-in-czk": ["manual", "review", []],
  // Dvě platby na jednu fakturu: obě ke kontrole.
  "twice-1": ["ambiguous", "review", ["twice"]],
  "twice-2": ["ambiguous", "review", ["twice"]],
  // Jen částka: ke kontrole, nikdy automaticky.
  "amount-only": ["exact", "review", ["amount-only"]],
  // Jméno plátce bez diakritiky a přesná částka (politika vs_and_name).
  "name-only": ["exact", "safe", ["name-only"]],
  // Odkaz na už uhrazenou fakturu: možná duplicitní platba.
  "already-paid": ["ambiguous", "review", ["already-paid"]],
  // ZNÁMÝ NEDOSTATEK (opraví krok P1): převod z vlastního účtu dostane návrh
  // faktury se shodným VS; má zůstat bez návrhu (je to „Nesouvisí“).
  "own-transfer": ["manual", "review", ["vs-exact"]],
  unknown: ["manual", "review", []],
  ignored: [null, null, []],
};

const run = (bookingPolicy: AutoBookingPolicy) => proposeStatement({
  rows: goldenRows, invoices: goldenInvoices, settledInvoices: goldenSettled,
  knownAccounts: goldenKnownAccounts, ownAccounts: goldenOwnAccounts, bookingPolicy,
});
const table = (result: ReturnType<typeof run>) =>
  Object.fromEntries([...result].map(([key, value]) => [key, [value.proposal_kind, value.proposal_confidence, value.proposed_invoice_ids]]));

describe("kontrolní sada výpisů", () => {
  it("navrhuje přesně očekávané přiřazení pro každý řádek (politika vs_and_name)", () => {
    expect(table(run("vs_and_name"))).toEqual(vsAndName);
  });

  it("politika jen podle VS posílá jméno a účet ke kontrole, VS nechává jisté", () => {
    const expected = { ...vsAndName, account: ["exact", "review", ["account"]], "name-only": ["exact", "review", ["name-only"]] };
    expect(table(run("vs"))).toEqual(expected);
  });

  it("vypnutá automatika nenechá nic jako jistou shodu", () => {
    const result = table(run("off"));
    expect(Object.values(result).every(([, confidence]) => confidence !== "safe")).toBe(true);
    expect(Object.keys(result)).toEqual(Object.keys(vsAndName));
  });

  it("každý návrh má vysvětlení pro člověka", () => {
    for (const [key, value] of run("vs_and_name"))
      if (value.proposal_kind) expect(value.proposal_reason, key).toMatch(/\S/);
  });
});
