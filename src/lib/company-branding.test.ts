import { describe, expect, it } from "vitest";
import { companyEmailLogoSource, renderCompanyEmailLogo } from "./company-branding";

describe("company email branding", () => {
  it("uses local assets for previews and absolute PNG URLs for delivery", () => {
    expect(companyEmailLogoSource(null)).toBe("/brand/splatno-auth-mark.png");
    expect(companyEmailLogoSource(null, "https://app.example.cz")).toBe("https://app.example.cz/brand/splatno-auth-mark.png");
    expect(companyEmailLogoSource(null, "")).toBe("https://www.splatno.cz/brand/splatno-auth-mark.png");
    expect(companyEmailLogoSource("/logo/company?v=42", "https://app.example.cz")).toBe("https://app.example.cz/logo/company?v=42");
  });

  it.each(["", "  ", "javascript:alert(1)", "data:text/html,unsafe", "//other.example/logo", "/\\other.example/logo"])("falls back safely for %s", (source) => {
    expect(companyEmailLogoSource(source)).toBe("/brand/splatno-auth-mark.png");
  });

  it("labels the default as Splatno and escapes custom company names", () => {
    expect(renderCompanyEmailLogo(null, "Firma")).toContain('alt="Splatno"');
    expect(renderCompanyEmailLogo("/logo/company?v=1&x=2", 'Firma "Novák"')).toContain('alt="Firma &quot;Novák&quot;"');
    expect(renderCompanyEmailLogo("/logo/company?v=1&x=2", "Firma")).toContain("v=1&amp;x=2");
  });
});
