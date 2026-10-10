import { describe, expect, it } from "vitest";
import { passwordProblem, passwordRule } from "./password-policy";

describe("password policy", () => {
  it("accepts a sufficiently strong password", () => {
    expect(passwordProblem("BezpecneHeslo2026")).toBeNull();
    expect(passwordRule("BezpecneHeslo2026")).toBeNull();
  });

  it("rejects short or one-dimensional passwords", () => {
    expect(passwordProblem("Heslo1")).toContain("12 znaků");
    expect(passwordProblem("VELMI-DLOUHE-123")).toContain("malé písmeno");
    expect(passwordProblem("velmi-dlouhe-123")).toContain("velké písmeno");
    expect(passwordProblem("VelmiDlouheHeslo")).toContain("číslo");
  });

  it("names the broken rule so the message can be translated", () => {
    expect(passwordRule("Heslo1")).toBe("length");
    expect(passwordRule("VELMI-DLOUHE-123")).toBe("lower");
    expect(passwordRule("velmi-dlouhe-123")).toBe("upper");
    expect(passwordRule("VelmiDlouheHeslo")).toBe("digit");
  });
});
