import { describe, expect, it, vi } from "vitest";
import { comgateConfiguration, createComgatePayment, getComgatePayment, isComgateSecret } from "./comgate";

const config = { merchant: "123456", secret: "tajny-klic", test: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("comgateConfiguration", () => {
  it("is off without credentials and stays in test mode unless production is explicit", () => {
    expect(comgateConfiguration({})).toBeNull();
    expect(comgateConfiguration({ COMGATE_MERCHANT: "1", COMGATE_SECRET: "s" })?.test).toBe(true);
    expect(comgateConfiguration({ COMGATE_MERCHANT: "1", COMGATE_SECRET: "s", COMGATE_TEST: "false" })?.test).toBe(false);
  });
});

describe("createComgatePayment", () => {
  it("creates a background payment in haléře with basic auth and return URLs", async () => {
    const fetchImpl = vi.fn(async () => json({ code: 0, message: "OK", transId: "AB12-CD34-EF56", redirect: "https://payments.comgate.cz/client/instructions/index?id=AB12" }));
    const result = await createComgatePayment({
      orderId: "order-1", priceHalere: 192390, label: "Splatno Profi měsíčně", email: "faktury@firma.cz", returnUrl: "https://splatno.cz/predplatne/navrat?objednavka=order-1",
    }, { config, fetchImpl });
    expect(result).toEqual({ ok: true, transId: "AB12-CD34-EF56", redirect: "https://payments.comgate.cz/client/instructions/index?id=AB12" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://payments.comgate.cz/v2.0/payment.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("123456:tajny-klic").toString("base64")}`);
    expect(JSON.parse(String(init.body))).toMatchObject({ price: 192390, curr: "CZK", refId: "order-1", method: "ALL", test: true, country: "CZ", lang: "cs" });
  });

  it("only accepts a redirect to Comgate itself", async () => {
    const fetchImpl = vi.fn(async () => json({ code: 0, transId: "X", redirect: "https://evil.example/pay" }));
    expect((await createComgatePayment({ orderId: "o", priceHalere: 100, label: "x", email: "a@b.cz", returnUrl: "https://splatno.cz" }, { config, fetchImpl })).ok).toBe(false);
  });

  it("reports a gateway refusal as failure", async () => {
    const fetchImpl = vi.fn(async () => json({ code: 1400, message: "Chybný požadavek" }, 400));
    expect((await createComgatePayment({ orderId: "o", priceHalere: 100, label: "x", email: "a@b.cz", returnUrl: "https://splatno.cz" }, { config, fetchImpl })).ok).toBe(false);
  });
});

describe("getComgatePayment", () => {
  it("reads the real state from Comgate (a push notification alone is never trusted)", async () => {
    const fetchImpl = vi.fn(async () => json({ code: 0, status: "PAID", price: 192390, curr: "CZK", refId: "order-1", transId: "AB12" }));
    expect(await getComgatePayment("AB12", { config, fetchImpl })).toEqual({ ok: true, status: "PAID", priceHalere: 192390, currency: "CZK", refId: "order-1", transId: "AB12" });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://payments.comgate.cz/v2.0/payment/transId/AB12.json");
  });
});

describe("isComgateSecret", () => {
  it("compares the notification secret exactly", () => {
    expect(isComgateSecret("tajny-klic", config)).toBe(true);
    expect(isComgateSecret("tajny-klix", config)).toBe(false);
    expect(isComgateSecret(undefined, config)).toBe(false);
  });
});
