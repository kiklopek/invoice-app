import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { isDecodableCompanyLogo } from "./company-logo-validation-server";

describe("ověření obrázku loga", () => {
  it.each(["png", "jpeg", "webp"] as const)("accepts a decodable %s image", async (format) => {
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#17613f" } }).toFormat(format).toBuffer();
    expect(await isDecodableCompanyLogo(image)).toBe(true);
  });
  it("rejects a valid signature followed by corrupt image data", async () => {
    expect(await isDecodableCompanyLogo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false);
    expect(await isDecodableCompanyLogo(new TextEncoder().encode("<svg/>"))).toBe(false);
  });
  it("rejects oversized dimensions even in a small compressed file", async () => {
    const image = await sharp({ create: { width: 4097, height: 1, channels: 3, background: "#fff" } }).png().toBuffer();
    expect(await isDecodableCompanyLogo(image)).toBe(false);
  });
});
