import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvoiceOcrOrganization } from "@/lib/invoice-ocr";
import { extractInvoiceWithGemini, GeminiOcrError } from "./invoice-ocr-gemini";

const organization: InvoiceOcrOrganization = { name: "Robert Hlavica", ico: "66151023", dic: "CZ7311145842" };

describe("invoice-ocr-gemini API key shape validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects a malformed key before ever calling fetch", async () => {
    // Synthetic value shaped like an OAuth-style token, not a Google AI
    // Studio key ("AIzaSy..."), which is precisely the case this guard
    // exists for.
    vi.stubEnv("GEMINI_API_KEY", "SYNTHETIC.not-a-real-google-ai-key-0000000000000000000");
    const fetchSpy = vi.spyOn(global, "fetch");

    await expect(
      extractInvoiceWithGemini({ bytes: new Uint8Array([1, 2, 3]), mime: "application/pdf", fileUrl: "org/file.pdf", organization }),
    ).rejects.toMatchObject({ code: "invalid_key_format" } satisfies Partial<GeminiOcrError>);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not retry an invalid key format (retrying can't fix a malformed key)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "not-a-real-key");
    const fetchSpy = vi.spyOn(global, "fetch");

    let caught: unknown;
    try {
      await extractInvoiceWithGemini({ bytes: new Uint8Array([1, 2, 3]), mime: "application/pdf", fileUrl: "org/file.pdf", organization });
    } catch (cause) {
      caught = cause;
    }
    expect(caught).toBeInstanceOf(GeminiOcrError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still rejects a missing key as not_configured, not invalid_key_format", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(
      extractInvoiceWithGemini({ bytes: new Uint8Array([1, 2, 3]), mime: "application/pdf", fileUrl: "org/file.pdf", organization }),
    ).rejects.toMatchObject({ code: "not_configured" } satisfies Partial<GeminiOcrError>);
  });
});
