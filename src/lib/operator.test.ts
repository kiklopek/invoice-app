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
});
