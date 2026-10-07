import { describe, expect, it } from "vitest";
import { PLANS, findPlan, monthlyPrice, quote } from "./plans";

describe("tarify", () => {
  it("keeps the prices shown on the landing page", () => {
    expect(PLANS.map((plan) => [plan.id, plan.monthlyCzk])).toEqual([["start", 790], ["profi", 1590], ["business", 2990]]);
  });

  it("gives 20 % off per month when paid yearly, rounded to whole crowns", () => {
    expect(monthlyPrice("profi", "monthly")).toBe(1590);
    expect(monthlyPrice("profi", "yearly")).toBe(1272);
    expect(monthlyPrice("start", "yearly")).toBe(632);
  });

  it("quotes an order in haléře with 21 % VAT", () => {
    expect(quote("profi", "monthly")).toEqual({ plan: "profi", period: "monthly", months: 1, netHalere: 159000, vatHalere: 33390, grossHalere: 192390 });
    expect(quote("business", "yearly")).toEqual({ plan: "business", period: "yearly", months: 12, netHalere: 2870400, vatHalere: 602784, grossHalere: 3473184 });
  });

  it("rejects unknown plans and periods so a forged request cannot set its own price", () => {
    expect(findPlan("free")).toBeNull();
    expect(() => quote("free" as never, "monthly")).toThrow();
    expect(() => quote("profi", "weekly" as never)).toThrow();
  });
});
