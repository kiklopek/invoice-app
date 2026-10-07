import { describe, expect, it } from "vitest";
import { detectLogoType, logoPathFor, MAX_LOGO_BYTES } from "./company-logo-file";

const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(20).fill(0)]);

describe("logo firmy", () => {
  it("recognises PNG, JPEG and WebP by their content, not by name", () => {
    expect(detectLogoType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectLogoType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectLogoType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0]))).toBe("image/webp");
  });

  it("refuses SVG, HTML and anything else (no script can hide in a logo)", () => {
    expect(detectLogoType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"))).toBeNull();
    expect(detectLogoType(new TextEncoder().encode("<html><body>hi</body></html>"))).toBeNull();
    expect(detectLogoType(new Uint8Array([]))).toBeNull();
  });

  it("limits size to 512 kB and builds a versioned path the database accepts", () => {
    expect(MAX_LOGO_BYTES).toBe(512 * 1024);
    expect(logoPathFor("22222222-2222-4222-8222-222222222222", 1700000000000)).toBe("/logo/22222222-2222-4222-8222-222222222222?v=1700000000000");
  });
});
