import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
vi.mock("server-only", () => ({}));
const download = vi.hoisted(() => vi.fn());
vi.mock("./supabase-server", () => ({
  createServiceClient: () => ({ storage: { from: () => ({ download }) } }),
}));
import { invoiceLogoBytes } from "./invoice-logo-server";
beforeEach(() => {
  download.mockReset();
});
describe("invoice branding", () => {
  it("uses Splatno without making a request when no company logo exists", async () => {
    const bytes = await invoiceLogoBytes();
    expect(bytes.length).toBeGreaterThan(100);
    expect([...bytes.slice(0, 4)]).toEqual([137, 80, 78, 71]);
    expect(download).not.toHaveBeenCalled();
  });
  it("loads only the managed company logo from its fixed object path", async () => {
    const bytes = readFileSync(
      join(process.cwd(), "public/brand/drevohlavica.png"),
    );
    download.mockResolvedValue({ data: new Blob([bytes]), error: null });
    expect(
      (
        await invoiceLogoBytes(
          "/logo/550e8400-e29b-41d4-a716-446655440000?v=42",
        )
      ).length,
    ).toBeGreaterThan(100);
    expect(download).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000/logo",
      {},
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
  it("falls back on missing or invalid company image data", async () => {
    download.mockResolvedValue({ data: new Blob(["invalid"]), error: null });
    expect(
      await invoiceLogoBytes("/logo/550e8400-e29b-41d4-a716-446655440000?v=42"),
    ).toEqual(await invoiceLogoBytes());
  });
  it("never follows arbitrary URLs or filesystem traversal", async () => {
    expect(
      await invoiceLogoBytes("https://internal.example/private.png"),
    ).toEqual(await invoiceLogoBytes());
    expect(await invoiceLogoBytes("/brand/../../private.png")).toEqual(
      await invoiceLogoBytes(),
    );
    expect(download).not.toHaveBeenCalled();
  });
});
