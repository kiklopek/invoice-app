import { describe, expect, it } from "vitest";
import { loginRequestIssue, loginTransportIssue } from "./login-issue";

describe("post-login errors", () => {
  it.each([
    [401, "expired", "Přihlášení vypršelo"],
    [403, "access", "Nepodařilo se ověřit přístup"],
    [503, "server", "Server momentálně neodpovídá"],
    [422, "company", "Nepodařilo se načíst firemní údaje"],
  ] as const)(
    "maps HTTP %s without blaming the network",
    (status, code, title) => {
      expect(loginRequestIssue(status, "access")).toMatchObject({
        code,
        title,
      });
    },
  );
  it("keeps an unrecognized session error generic", () => {
    expect(loginRequestIssue(400, "session")).toMatchObject({
      code: "unknown",
      retryable: false,
    });
  });
  it.each([
    [new TypeError("secret URL"), "network"],
    [new DOMException("secret", "TimeoutError"), "timeout"],
    [new DOMException("secret", "AbortError"), "aborted"],
    [new Error("secret token"), "unknown"],
  ] as const)(
    "distinguishes transport errors without exposing details",
    (error, code) => {
      const issue = loginTransportIssue(error);
      expect(issue.code).toBe(code);
      expect(JSON.stringify(issue)).not.toContain("secret");
    },
  );
});
