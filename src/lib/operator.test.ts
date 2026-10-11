import { describe, expect, it } from "vitest";
import { isOperatorEmail } from "./operator";

describe("provozovatel Splatna", () => {
  it("is only an exact e-mail from SPLATNO_OPERATOR_EMAILS", () => {
    const env = { SPLATNO_OPERATOR_EMAILS: "Jan@Splatno.cz, druhy@splatno.cz" };
    expect(isOperatorEmail("jan@splatno.cz", env)).toBe(true);
    expect(isOperatorEmail(" DRUHY@splatno.cz ", env)).toBe(true);
    expect(isOperatorEmail("jan@splatno.cz.evil.example", env)).toBe(false);
    expect(isOperatorEmail("jan@splatno.cz", {})).toBe(false);
    expect(isOperatorEmail("", { SPLATNO_OPERATOR_EMAILS: "" })).toBe(false);
  });

  // Účet s obchvatem 2FA (testovací účet) se nikdy nestane provozovatelem:
  // support vstupuje do cizích firem a bez 2FA by to byla zadní vrátka.
  it("never treats the 2FA-bypassed test account as an operator", () => {
    const env = { SPLATNO_OPERATOR_EMAILS: "test-admin@hlavica.cz, podpora@splatno.cz" };
    expect(isOperatorEmail("test-admin@hlavica.cz", env)).toBe(false);
    expect(isOperatorEmail("podpora@splatno.cz", env)).toBe(true);
  });
});
