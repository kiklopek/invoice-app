import { describe, expect, it } from "vitest";
import { passwordProblem } from "./password-policy";

describe("password policy", () => {
  it("accepts a sufficiently strong password", () => {
    expect(passwordProblem("BezpecneHeslo2026")).toBeNull();
  });

  it("rejects short or one-dimensional passwords", () => {
    expect(passwordProblem("Heslo1")).toContain("12 znaků");
    expect(passwordProblem("VELMI-DLOUHE-123")).toContain("malé písmeno");
    expect(passwordProblem("velmi-dlouhe-123")).toContain("velké písmeno");
    expect(passwordProblem("VelmiDlouheHeslo")).toContain("číslo");
  });
});
