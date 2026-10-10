import { describe, expect, it } from "vitest";
import { isIssuerReminderAddress } from "./reminder-recipient-safety";

describe("vlastní e-mail vystavitele", () => {
  it("blokuje přesnou adresu a doménu Hlavica včetně poddomény", () => {
    const issuer = { name: "R. Hlavica s.r.o.", email: "info@hlavica.cz" };
    expect(isIssuerReminderAddress("INFO@HLAVICA.CZ", issuer)).toBe(true);
    expect(isIssuerReminderAddress("kostihova@hlavica.cz", issuer)).toBe(true);
    expect(isIssuerReminderAddress("faktury@mail.hlavica.cz", issuer)).toBe(true);
    expect(isIssuerReminderAddress("uctarna@odberatel.cz", issuer)).toBe(false);
    expect(isIssuerReminderAddress("info@hlavica.cz.evil.example", issuer)).toBe(false);
  });

  it("blokuje vlastní firemní doménu u jakékoli firmy, ne jen u jedné konkrétní", () => {
    const issuer = { name: "Jiná firma s.r.o.", email: "info@jina-firma.cz" };
    expect(isIssuerReminderAddress("ucetni@jina-firma.cz", issuer)).toBe(true);
    expect(isIssuerReminderAddress("faktury@mail.jina-firma.cz", issuer)).toBe(true);
    expect(isIssuerReminderAddress("ucetni@jina-firma.cz.example", issuer)).toBe(false);
    expect(isIssuerReminderAddress("ucetni@odberatel.cz", issuer)).toBe(false);
  });

  it("bez e-mailu firmy v Nastavení nic neblokuje podle domény", () => {
    expect(isIssuerReminderAddress("kostihova@hlavica.cz", { name: "R. Hlavica s.r.o.", email: null })).toBe(false);
  });

  it("u veřejných schránek blokuje jen přesnou adresu firmy", () => {
    for (const domain of ["seznam.cz", "email.cz", "centrum.cz", "outlook.com", "icloud.com"]) {
      const issuer = { name: "OSVČ", email: `firma@${domain}` };
      expect(isIssuerReminderAddress(`firma@${domain}`, issuer)).toBe(true);
      expect(isIssuerReminderAddress(`zakaznik@${domain}`, issuer)).toBe(false);
    }
  });

  it("u jiné firmy neblokuje celou veřejnou e-mailovou doménu", () => {
    const issuer = { name: "Jiná firma s.r.o.", email: "firma@gmail.com" };
    expect(isIssuerReminderAddress("firma@gmail.com", issuer)).toBe(true);
    expect(isIssuerReminderAddress("zakaznik@gmail.com", issuer)).toBe(false);
    expect(isIssuerReminderAddress("kontakt@hlavica.cz", issuer)).toBe(false);
  });
});

// Firma s e-mailem na veřejné schránce blokuje jen svou přesnou adresu,
// ne všechny zákazníky na stejném poskytovateli.
describe("veřejné schránky mimo CZ", () => {
  it("does not block customers sharing a public provider with the issuer", () => {
    for (const domain of ["web.de", "yahoo.cz", "wp.pl", "aol.com"]) {
      expect(isIssuerReminderAddress(`zakaznik@${domain}`, { email: `firma@${domain}` })).toBe(false);
      expect(isIssuerReminderAddress(`firma@${domain}`, { email: `firma@${domain}` })).toBe(true);
    }
  });
});
