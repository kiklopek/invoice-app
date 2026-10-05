import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AMOUNT_ADJUSTMENT_TOLERANCE, grossFromNet } from "./vat";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("tolerance pro rozdíl mezi zadanou a dopočítanou částkou", () => {
  it("rozlišuje drobné zaokrouhlení při porovnávání zdrojů OCR", () => {
    expect(AMOUNT_ADJUSTMENT_TOLERANCE).toBeGreaterThan(0);
    expect(AMOUNT_ADJUSTMENT_TOLERANCE).toBeLessThan(1); // still nowhere near "real money"
    const net = 10000, rate = 21;
    const roundingNoise = grossFromNet(net, rate) + 0.04;
    const realError = grossFromNet(net, rate) + 50;
    expect(Math.abs(roundingNoise - grossFromNet(net, rate))).toBeLessThanOrEqual(AMOUNT_ADJUSTMENT_TOLERANCE);
    expect(Math.abs(realError - grossFromNet(net, rate))).toBeGreaterThan(AMOUNT_ADJUSTMENT_TOLERANCE);
  });

  it("nezobrazuje výpočet ani nevyžaduje potvrzení rozdílu", () => {
    const form = source("src/components/invoice-form.tsx");
    expect(form).not.toContain("needsAmountReview");
    expect(form).not.toContain("Výpočet ze základu a sazby");
    expect(form).not.toContain("Přepočítat celkem na");
    expect(form).not.toContain("Důvod rozdílu");
    const trigger = source("supabase/migrations/20261005113440_accept_invoice_total_without_adjustment_confirmation.sql");
    expect(trigger).not.toContain("unconfirmed_amount_adjustment");
    expect(trigger).toContain("unconfirmed_initial_payment");
    expect(trigger).toContain("original_amount_is_immutable");
  });
});
