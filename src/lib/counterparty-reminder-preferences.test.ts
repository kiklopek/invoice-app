import { describe, expect, it } from "vitest";
import { normalizeCounterpartyIco, resolveOcrReminderPolicy } from "./counterparty-reminder-preferences";

const policies = [
  { id: "standard", name: "Standardní", is_default: true },
  { id: "vip", name: "VIP", is_default: false },
];

describe("counterparty reminder preferences", () => {
  it("normalizes a Czech ICO and rejects incomplete values", () => {
    expect(normalizeCounterpartyIco("12 345 678")).toBe("12345678");
    expect(normalizeCounterpartyIco("123")).toBeNull();
  });

  it("uses a remembered active policy for a known ICO", () => {
    expect(resolveOcrReminderPolicy({ counterpartyIco: "12345678", preferredPolicyId: "vip", policies }))
      .toEqual({ status: "remembered", counterparty_ico: "12345678", policy_id: "vip", policy_name: "VIP" });
  });

  it("asks for a check while preselecting the default for a new ICO", () => {
    expect(resolveOcrReminderPolicy({ counterpartyIco: "87654321", preferredPolicyId: null, policies }))
      .toEqual({ status: "default", counterparty_ico: "87654321", policy_id: "standard", policy_name: "Standardní" });
  });

  it("falls back safely when a remembered policy is archived", () => {
    expect(resolveOcrReminderPolicy({ counterpartyIco: "12345678", preferredPolicyId: "archived", policies }))
      .toEqual({ status: "default", counterparty_ico: "12345678", policy_id: "standard", policy_name: "Standardní" });
  });

  it("reports a missing ICO while keeping invoice creation usable", () => {
    expect(resolveOcrReminderPolicy({ counterpartyIco: "", preferredPolicyId: null, policies }))
      .toEqual({ status: "missing_ico", counterparty_ico: null, policy_id: "standard", policy_name: "Standardní" });
  });
});
