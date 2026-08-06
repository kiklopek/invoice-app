import { describe, expect, it } from "vitest";
import { hasExpectedDocumentSignature, validateDocumentMetadata } from "./document-validation";

describe("document validation", () => {
  it("pozná podporované signatury souborů", () => {
    expect(hasExpectedDocumentSignature(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).toBe(true);
    expect(hasExpectedDocumentSignature(new TextEncoder().encode("%PDF-1.7"), "application/pdf")).toBe(true);
    expect(hasExpectedDocumentSignature(new TextEncoder().encode("not a pdf"), "application/pdf")).toBe(false);
  });

  it("vynutí typ a limit deseti megabajtů", () => {
    expect(validateDocumentMetadata("application/pdf", 1024)).toBeNull();
    expect(validateDocumentMetadata("text/html", 1024)).toContain("PDF");
    expect(validateDocumentMetadata("application/pdf", 10 * 1024 * 1024 + 1)).toContain("10 MB");
  });
});

