import { describe, expect, it } from "vitest";
import { renderAuthCodeEmail } from "./auth-code-email";

describe("branded authentication code emails", () => {
  it.each(["cs", "en"] as const)("renders distinct signup and login instructions in %s", locale => {
    const login = renderAuthCodeEmail({ code: "A7K9B", purpose: "login", locale });
    const signup = renderAuthCodeEmail({ code: "A7K9B", purpose: "registration", locale });
    expect(login.html).toContain('role="presentation"');
    expect(login.html).toContain('src="https://www.splatno.cz/brand/splatno-auth-mark.png"');
    expect(login.html).toContain('dir="ltr"');
    expect(login.html).toContain("A7K9B");
    expect(login.text).toContain("10 minut");
    expect(signup.text).toContain("10 minut");
    expect(signup.text).not.toEqual(login.text);
    expect(login.html).not.toMatch(/href=|localhost|\/auth\/callback/);
    expect(signup.html).not.toMatch(/href=|localhost|\/auth\/callback/);
    expect(signup.text).toContain("A7K9B");
  });
  it.each(["<script>", "12345", "12345678901", "123 456"])("rejects invalid code %s before including it in HTML", code => {
    expect(() => renderAuthCodeEmail({ code, purpose: "login" })).toThrow("INVALID_AUTH_EMAIL_CODE");
  });
});
