import { describe, expect, it } from "vitest";
import { currentEntryLoginPath, loginEntryPath, withEntry } from "./login-entry";

describe("withEntry", () => {
  it("adds nothing on the generic entry, so generic pages never carry R. Hlavica", () => {
    expect(withEntry("/forgot-password", "splatno")).toBe("/forgot-password");
    expect(withEntry("/mfa?returnTo=%2Fdashboard", "splatno")).toBe("/mfa?returnTo=%2Fdashboard");
  });

  it("carries the R. Hlavica entry to the next page", () => {
    expect(withEntry("/forgot-password", "hlavica")).toBe("/forgot-password?vstup=hlavica");
    expect(withEntry("/mfa?returnTo=%2Fdashboard", "hlavica")).toBe("/mfa?returnTo=%2Fdashboard&vstup=hlavica");
  });
});

describe("přihlašovací stránka", () => {
  it("is always the generic /login, also for people who came through /hlavica", () => {
    // Firmu určuje účet, ne adresa: po odhlášení, změně hesla i z 2FA se
    // jde vždy na splatno.cz/login.
    expect(loginEntryPath()).toBe("/login");
    expect(currentEntryLoginPath()).toBe("/login");
  });
});
