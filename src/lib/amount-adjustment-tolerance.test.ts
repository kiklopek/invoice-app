import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AMOUNT_ADJUSTMENT_TOLERANCE, grossFromNet } from "./vat";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("tolerance pro rozdíl mezi zadanou a dopočítanou částkou", () => {
  it("nevyžaduje potvrzení pro haléřové zaokrouhlení, ale drží přísnost na skutečné rozdíly", () => {
    // Real bug: 0.04 Kč rounding remainder (routine on a multi-line invoice
    // where each line rounds to 2 decimals before summing) forced the exact
    // same mandatory "explain and confirm" step as a genuinely wrong amount.
    expect(AMOUNT_ADJUSTMENT_TOLERANCE).toBeGreaterThan(0);
    expect(AMOUNT_ADJUSTMENT_TOLERANCE).toBeLessThan(1); // still nowhere near "real money"
    const net = 10000, rate = 21;
    const roundingNoise = grossFromNet(net, rate) + 0.04;
    const realError = grossFromNet(net, rate) + 50;
    expect(Math.abs(roundingNoise - grossFromNet(net, rate))).toBeLessThanOrEqual(AMOUNT_ADJUSTMENT_TOLERANCE);
    expect(Math.abs(realError - grossFromNet(net, rate))).toBeGreaterThan(AMOUNT_ADJUSTMENT_TOLERANCE);
  });

  it("invoice-form.tsx a validate_invoice_money_evidence používají stejnou hodnotu", () => {
    const form = source("src/components/invoice-form.tsx");
    expect(form).toContain("Math.abs(amountDifference) > AMOUNT_ADJUSTMENT_TOLERANCE");
    const trigger = source("supabase/migrations/20260920090000_tolerate_rounding_adjustment.sql");
    expect(trigger).toContain("abs(difference)>0.05");
    // 0.05 v SQL musí odpovídat AMOUNT_ADJUSTMENT_TOLERANCE v TS -- kdyby se
    // někdy jedna hodnota změnila bez druhé, UI a databáze by se rozešly
    // (formulář by neukázal potvrzení, které DB stejně vyžaduje, a uložení
    // by tvrdě spadlo na unconfirmed_amount_adjustment).
    expect(AMOUNT_ADJUSTMENT_TOLERANCE).toBe(0.05);
  });
});
