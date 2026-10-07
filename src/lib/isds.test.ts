import { describe, expect, it, vi } from "vitest";
import { findCompanyDataBox, isdsConfiguration, sendDataBoxMessage, verificationCodeHash } from "./isds";

const config = { username: "splatno01", password: "tajne", baseUrl: "https://ws1.czebox.cz/DS/" };
const xml = (body: string) => new Response(`<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`, { status: 200 });

describe("isdsConfiguration", () => {
  it("is off without credentials and points to the test environment unless production is explicit", () => {
    expect(isdsConfiguration({})).toBeNull();
    expect(isdsConfiguration({ ISDS_USERNAME: "a", ISDS_PASSWORD: "b" })?.baseUrl).toBe("https://ws1.czebox.cz/DS/");
    expect(isdsConfiguration({ ISDS_USERNAME: "a", ISDS_PASSWORD: "b", ISDS_ENV: "production" })?.baseUrl).toBe("https://ws1.mojedatovaschranka.cz/DS/");
  });
});

describe("findCompanyDataBox", () => {
  it("searches legal-entity boxes by IČO with basic auth and returns the box of exactly that IČO", async () => {
    const fetchImpl = vi.fn(async () => xml(`<p:FindDataBoxResponse xmlns:p="http://isds.czechpoint.cz/v20"><p:dbResults><p:dbOwnerInfo><p:dbID>ab12cde</p:dbID><p:dbType>PO</p:dbType><p:ic>27082440</p:ic><p:firmName>Nová firma s.r.o.</p:firmName></p:dbOwnerInfo></p:dbResults><p:dbStatus><p:dbStatusCode>0000</p:dbStatusCode><p:dbStatusMessage>OK</p:dbStatusMessage></p:dbStatus></p:FindDataBoxResponse>`));
    const result = await findCompanyDataBox("27082440", { config, fetchImpl });
    expect(result).toEqual({ status: "found", dataBoxId: "ab12cde", firmName: "Nová firma s.r.o." });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ws1.czebox.cz/DS/df");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("splatno01:tajne").toString("base64")}`);
    expect(String(init.body)).toContain("<dbType>PO</dbType><ic>27082440</ic>");
  });

  it("ignores boxes of a different IČO (a search must never verify the wrong company)", async () => {
    const fetchImpl = vi.fn(async () => xml(`<p:FindDataBoxResponse xmlns:p="http://isds.czechpoint.cz/v20"><p:dbResults><p:dbOwnerInfo><p:dbID>zz99zzz</p:dbID><p:ic>11111111</p:ic></p:dbOwnerInfo></p:dbResults><p:dbStatus><p:dbStatusCode>0000</p:dbStatusCode></p:dbStatus></p:FindDataBoxResponse>`));
    expect(await findCompanyDataBox("27082440", { config, fetchImpl })).toEqual({ status: "not_found" });
  });

  it("reports an ISDS error or outage as unavailable, never as success", async () => {
    const errorBody = vi.fn(async () => xml(`<p:FindDataBoxResponse xmlns:p="http://isds.czechpoint.cz/v20"><p:dbStatus><p:dbStatusCode>1103</p:dbStatusCode><p:dbStatusMessage>Chyba</p:dbStatusMessage></p:dbStatus></p:FindDataBoxResponse>`));
    expect((await findCompanyDataBox("27082440", { config, fetchImpl: errorBody })).status).toBe("unavailable");
    const down = vi.fn(async () => new Response("", { status: 503 }));
    expect((await findCompanyDataBox("27082440", { config, fetchImpl: down })).status).toBe("unavailable");
    const throws = vi.fn(async () => { throw new Error("ECONNRESET"); });
    expect((await findCompanyDataBox("27082440", { config, fetchImpl: throws })).status).toBe("unavailable");
  });
});

describe("sendDataBoxMessage", () => {
  it("sends one text document to the given box and returns the message id", async () => {
    const fetchImpl = vi.fn(async () => xml(`<p:CreateMessageResponse xmlns:p="http://isds.czechpoint.cz/v20"><p:dmID>1234567</p:dmID><p:dmStatus><p:dmStatusCode>0000</p:dmStatusCode><p:dmStatusMessage>OK</p:dmStatusMessage></p:dmStatus></p:CreateMessageResponse>`));
    const result = await sendDataBoxMessage({ dataBoxId: "ab12cde", subject: "Ověřovací kód <Splatno>", text: "Kód: 123456" }, { config, fetchImpl });
    expect(result).toEqual({ status: "sent", messageId: "1234567" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ws1.czebox.cz/DS/dz");
    const body = String(init.body);
    expect(body).toContain("<dbIDRecipient>ab12cde</dbIDRecipient>");
    expect(body).toContain("Ověřovací kód &lt;Splatno&gt;");
    expect(body).toContain(`<dmEncodedContent>${Buffer.from("Kód: 123456", "utf8").toString("base64")}</dmEncodedContent>`);
    expect(body).toContain('dmFileMetaType="main"');
  });

  it("refuses a malformed box id before calling ISDS", async () => {
    const fetchImpl = vi.fn();
    expect((await sendDataBoxMessage({ dataBoxId: "x</dbID>", subject: "a", text: "b" }, { config, fetchImpl })).status).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("verificationCodeHash", () => {
  it("binds the code to the company, so a code for one company cannot verify another", () => {
    const a = verificationCodeHash({ organizationId: "org-a", code: "123456", secret: "x".repeat(32) });
    const b = verificationCodeHash({ organizationId: "org-b", code: "123456", secret: "x".repeat(32) });
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
  });
});
