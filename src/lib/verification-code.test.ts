import { describe, expect, it } from "vitest";
import { generateVerificationCode } from "./verification-code-server";
import { isVerificationCode, normalizeVerificationCode } from "./verification-code";

describe("five-character verification codes", () => {
  it("always generates five distinct unambiguous characters, including a number and a letter", () => {
    for (let index = 0; index < 200; index++) {
      const code = generateVerificationCode();
      expect(isVerificationCode(code)).toBe(true);
      expect(code).toHaveLength(5);
      expect(new Set(code).size).toBe(5);
      expect(code).toMatch(/[A-Z]/);
      expect(code).toMatch(/[2-9]/);
      expect(code).not.toMatch(/[01IO]/);
    }
  });
  it("accepts lowercase pasted text and separators", () => {
    expect(normalizeVerificationCode(" a7-k9 b ")).toBe("A7K9B");
  });
  it.each(["AAAAA", "A7A9B", "ABCDE", "23456", "A0K9B", "A1K9B", "A7I9B", "A7O9B", "123456", "A7K9", "A7K9BC"])("rejects malformed code %s", code => {
    expect(isVerificationCode(code)).toBe(false);
  });
});
