import { describe, expect, it } from "vitest";
import { PLANS, TRIAL_DAYS, TRIAL_INVOICE_LIMIT, changeKind, findPlan, lookupKey, monthlyPrice, parseLookupKey, quote } from "./plans";

describe("tarify", () => {
  it("keeps the prices shown on the landing page", () => {
    expect(PLANS.map((plan) => [plan.id, plan.monthlyCzk])).toEqual([["start", 790], ["profi", 1590], ["business", 2990]]);
  });

  it("charges 10 months for a year (2 months free), shown per month rounded to whole crowns", () => {
    expect(monthlyPrice("profi", "monthly")).toBe(1590);
    expect(monthlyPrice("profi", "yearly")).toBe(1325);
    expect(monthlyPrice("start", "yearly")).toBe(658);
  });

  it("quotes in haléře with 21 % VAT; a year is exactly ten monthly prices", () => {
    expect(quote("profi", "monthly")).toEqual({ plan: "profi", period: "monthly", months: 1, netHalere: 159000, vatHalere: 33390, grossHalere: 192390 });
    expect(quote("business", "yearly")).toEqual({ plan: "business", period: "yearly", months: 12, netHalere: 2990000, vatHalere: 627900, grossHalere: 3617900 });
  });

  it("rejects unknown plans and periods so a forged request cannot set its own price", () => {
    expect(findPlan("free")).toBeNull();
    expect(() => quote("free" as never, "monthly")).toThrow();
    expect(() => quote("profi", "weekly" as never)).toThrow();
  });

  it("trial is 14 days and at most 50 invoices", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(TRIAL_INVOICE_LIMIT).toBe(50);
  });
});

describe("Stripe lookup keys", () => {
  it("round-trips every plan and period", () => {
    for (const plan of PLANS) {
      for (const period of ["monthly", "yearly"] as const) {
        expect(parseLookupKey(lookupKey(plan.id, period))).toEqual({ plan: plan.id, period });
      }
    }
  });

  it("ignores prices that are not ours", () => {
    expect(parseLookupKey("splatno_free_monthly")).toBeNull();
    expect(parseLookupKey("other_profi_monthly")).toBeNull();
    expect(parseLookupKey(null)).toBeNull();
  });
});

describe("změna tarifu", () => {
  const at = (plan: "start" | "profi" | "business", period: "monthly" | "yearly") => ({ plan, period });

  it("higher plan in the same period is an upgrade (charged now, prorated)", () => {
    expect(changeKind(at("start", "monthly"), at("profi", "monthly"))).toBe("upgrade");
    expect(changeKind(at("profi", "yearly"), at("business", "yearly"))).toBe("upgrade");
  });

  it("lower plan is a downgrade (from the next period, no refund)", () => {
    expect(changeKind(at("business", "monthly"), at("start", "monthly"))).toBe("downgrade");
  });

  it("monthly to yearly is an upgrade, yearly to monthly a downgrade, like other SaaS", () => {
    expect(changeKind(at("profi", "monthly"), at("profi", "yearly"))).toBe("upgrade");
    expect(changeKind(at("business", "monthly"), at("start", "yearly"))).toBe("upgrade");
    expect(changeKind(at("start", "yearly"), at("business", "monthly"))).toBe("downgrade");
  });

  it("same plan and period is no change", () => {
    expect(changeKind(at("profi", "monthly"), at("profi", "monthly"))).toBe("same");
  });
});
