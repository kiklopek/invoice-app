import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import sharp from "sharp";
import { buildSpayd } from "./czech-payment";
import { decodeQrCodesFromImage, spaydToExactReading } from "./invoice-qr";

async function invoicePageWithQr(payload: string) {
  const qr = await QRCode.toBuffer(payload, { errorCorrectionLevel: "M", margin: 2, width: 220 });
  // Stránka A4 při 150 dpi, QR vpravo dole jako na běžné faktuře.
  return sharp({ create: { width: 1240, height: 1754, channels: 3, background: "#ffffff" } })
    .composite([{ input: qr, left: 960, top: 1450 }])
    .png()
    .toBuffer();
}

describe("QR platba na stránce faktury", () => {
  it("najde a přečte QR platbu na vykreslené stránce", async () => {
    const spayd = buildSpayd({ account: "6786420257/0100", amount: 3370, currency: "CZK", variableSymbol: "426198", dueDate: "2026-09-16" })!;
    const codes = await decodeQrCodesFromImage(new Uint8Array(await invoicePageWithQr(spayd)));
    expect(codes).toContain(spayd);
  });

  it("stránka bez QR kódu nic nevrátí a nespadne", async () => {
    const blank = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#ffffff" } }).png().toBuffer();
    expect(await decodeQrCodesFromImage(new Uint8Array(blank))).toEqual([]);
    expect(await decodeQrCodesFromImage(new Uint8Array([1, 2, 3]))).toEqual([]);
  });

  it("z QR platby udělá přesný zdroj jen pro částku, VS, měnu a splatnost", () => {
    const spayd = buildSpayd({ account: "6786420257/0100", amount: 123100.2, currency: "CZK", variableSymbol: "1443260157", dueDate: "2026-09-23" })!;
    const reading = spaydToExactReading([spayd, "https://example.com"]);
    expect(reading).toMatchObject({
      method: "qr",
      values: { amount: 123100.2, variable_symbol: "1443260157", currency: "CZK", due_date: "2026-09-23" },
    });
    expect(reading?.evidence?.amount).toContain("AM:123100.20");
  });

  it("dvě různé QR platby na jednom dokumentu nevyberou vítěze", () => {
    const first = buildSpayd({ account: "6786420257/0100", amount: 100, currency: "CZK" })!;
    const second = buildSpayd({ account: "6786420257/0100", amount: 200, currency: "CZK" })!;
    const reading = spaydToExactReading([first, second]);
    expect(reading?.values).toEqual({});
    expect(reading?.warnings?.join(" ")).toContain("více různých QR plateb");
  });

  it("bez QR platby vrátí null", () => {
    expect(spaydToExactReading([])).toBeNull();
    expect(spaydToExactReading(["SPD*1.0*AM:100.00"])).toBeNull();
  });
});
