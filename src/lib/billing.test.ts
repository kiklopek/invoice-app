import { describe, expect, it } from "vitest";
import { normalizeBillingDetails, subscriptionState, supplierConfiguration, trialWarning } from "./billing";

const now = new Date("2026-10-07T12:00:00Z");

describe("subscriptionState", () => {
  it("knows trial, active, unlimited and expired", () => {
    expect(subscriptionState({ status: "trial", trial_ends_at: "2026-10-20T00:00:00Z", current_period_end: null }, now)).toBe("trial");
    expect(subscriptionState({ status: "trial", trial_ends_at: "2026-10-01T00:00:00Z", current_period_end: null }, now)).toBe("expired");
    expect(subscriptionState({ status: "active", trial_ends_at: null, current_period_end: "2027-10-01T00:00:00Z" }, now)).toBe("active");
    expect(subscriptionState({ status: "active", trial_ends_at: null, current_period_end: null }, now)).toBe("active");
    expect(subscriptionState({ status: "active", trial_ends_at: null, current_period_end: "2026-10-06T00:00:00Z" }, now)).toBe("expired");
    expect(subscriptionState({ status: "cancelled", trial_ends_at: null, current_period_end: null }, now)).toBe("expired");
  });

  // Firma bez řádku předplatného (stávající data) nesmí přijít o přístup kvůli chybě v datech.
  it("treats a missing subscription as active, never as a lockout", () => {
    expect(subscriptionState(null, now)).toBe("active");
  });
});

describe("trialWarning", () => {
  it("warns during the last 7 days and after expiry", () => {
    expect(trialWarning({ status: "trial", trial_ends_at: "2026-10-30T00:00:00Z", current_period_end: null }, now)).toBeNull();
    expect(trialWarning({ status: "trial", trial_ends_at: "2026-10-10T12:00:00Z", current_period_end: null }, now)).toEqual({ kind: "ending", daysLeft: 3 });
    expect(trialWarning({ status: "trial", trial_ends_at: "2026-10-01T00:00:00Z", current_period_end: null }, now)).toEqual({ kind: "expired", daysLeft: 0 });
  });
});

describe("normalizeBillingDetails", () => {
  it("requires name, valid IČO and e-mail and keeps only known fields", () => {
    expect(normalizeBillingDetails({ name: " Firma ", ico: "27082440", email: "Faktury@Firma.cz", address: "Ulice 1", dic: "cz27082440", extra: "x" }))
      .toEqual({ ok: true, details: { name: "Firma", ico: "27082440", dic: "CZ27082440", address: "Ulice 1", email: "faktury@firma.cz" } });
    expect(normalizeBillingDetails({ name: "", ico: "27082440", email: "a@b.cz" }).ok).toBe(false);
    expect(normalizeBillingDetails({ name: "F", ico: "12345678", email: "a@b.cz" }).ok).toBe(false);
    expect(normalizeBillingDetails({ name: "F", ico: "27082440", email: "x" }).ok).toBe(false);
  });
});

describe("supplierConfiguration", () => {
  it("needs the supplier identity and a valid bank account before anything can be invoiced", () => {
    expect(supplierConfiguration({})).toBeNull();
    const supplier = supplierConfiguration({
      SPLATNO_SUPPLIER_NAME: "Splatno s.r.o.", SPLATNO_SUPPLIER_ICO: "27082440", SPLATNO_SUPPLIER_ADDRESS: "Ulice 1, Praha",
      SPLATNO_SUPPLIER_ACCOUNT: "19-2000145399/0800", SPLATNO_SUPPLIER_VAT_PAYER: "true", SPLATNO_SUPPLIER_DIC: "CZ27082440",
    });
    expect(supplier).toMatchObject({ name: "Splatno s.r.o.", vatPayer: true, iban: "CZ6508000000192000145399" });
    expect(supplierConfiguration({ SPLATNO_SUPPLIER_NAME: "S", SPLATNO_SUPPLIER_ICO: "27082440", SPLATNO_SUPPLIER_ADDRESS: "A", SPLATNO_SUPPLIER_ACCOUNT: "19-2000145398/0800" })).toBeNull();
  });
});

describe("organizationsAllowedToSend", () => {
  it("pauses reminder sending only for companies whose trial or plan has ended", async () => {
    const { organizationsAllowedToSend } = await import("./billing");
    const rows = [
      { organization_id: "trial", status: "trial", trial_ends_at: "2026-10-20T00:00:00Z", current_period_end: null },
      { organization_id: "expired", status: "trial", trial_ends_at: "2026-10-01T00:00:00Z", current_period_end: null },
      { organization_id: "paid", status: "active", trial_ends_at: null, current_period_end: "2027-01-01T00:00:00Z" },
    ];
    expect(organizationsAllowedToSend(["trial", "expired", "paid", "legacy"], rows, now)).toEqual(["trial", "paid", "legacy"]);
  });
});

describe("cron upomínek", () => {
  it("claims reminder jobs only for companies allowed to send", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/app/api/cron/check-due/route.ts", "utf8");
    expect(source).toContain("organizationsAllowedToSend(");
    expect(source).toMatch(/claim_reminder_jobs", \{\s*target_organizations: sendingOrganizationIds,/);
  });
});
