import { describe, expect, it } from "vitest";
import { normalizeOnboardingCompany, onboardingErrorMessage, validateOnboardingCompany } from "./onboarding";

const valid = {
  name: " Nová firma s.r.o. ",
  ico: "27082440",
  dic: "cz27082440",
  registered_address: "Dlouhá 1, Praha",
  email: " Faktury@NovaFirma.cz ",
  bank_account_czk: "19-2000145399/0800",
};

describe("normalizeOnboardingCompany", () => {
  it("trims, normalizes and keeps only known fields", () => {
    const company = normalizeOnboardingCompany({ ...valid, settings_revision: 9, created_by: "someone" });
    expect(company).toEqual({
      name: "Nová firma s.r.o.",
      ico: "27082440",
      dic: "CZ27082440",
      registered_address: "Dlouhá 1, Praha",
      operating_address: "",
      data_box_id: "",
      phone: "",
      email: "faktury@novafirma.cz",
      bank_account_czk: "19-2000145399/0800",
      bank_account_eur: "",
    });
  });

  it("survives garbage input", () => {
    expect(normalizeOnboardingCompany(null).name).toBe("");
    expect(normalizeOnboardingCompany({ name: 42 }).name).toBe("");
  });
});

describe("validateOnboardingCompany", () => {
  it("accepts a complete company", () => {
    expect(validateOnboardingCompany(normalizeOnboardingCompany(valid))).toEqual([]);
  });

  it("requires the CZK account: without it no payment can ever be matched", () => {
    const errors = validateOnboardingCompany(normalizeOnboardingCompany({ ...valid, bank_account_czk: "" }));
    expect(errors.map((error) => error.field)).toEqual(["bank_account_czk"]);
  });

  it("reports every problem at once", () => {
    const errors = validateOnboardingCompany(normalizeOnboardingCompany({ ...valid, ico: "12345678", email: "x", bank_account_czk: "19-2000145398/0800" }));
    expect(errors.map((error) => error.field).sort()).toEqual(["bank_account_czk", "email", "ico"]);
  });
});

describe("onboardingErrorMessage", () => {
  it("explains a taken ICO without revealing who owns it", () => {
    const error = onboardingErrorMessage("ico_taken");
    expect(error?.status).toBe(409);
    expect(error?.message).toContain("už ve Splatnu je");
  });

  it("tells an already-member to go to the dashboard", () => {
    expect(onboardingErrorMessage("already_member")?.code).toBe("already_member");
    expect(onboardingErrorMessage("pending_invitation")?.message).toContain("pozvánk");
    expect(onboardingErrorMessage("boom")).toBeNull();
  });
});
