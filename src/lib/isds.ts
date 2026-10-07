import { createHmac } from "node:crypto";

// Klient Informačního systému datových schránek (ISDS) pro ověření firmy:
// najde datovou schránku firmy podle IČO a pošle do ní zprávu s kódem.
// Přihlášení jménem a heslem datové schránky Splatna (ISDS_USERNAME,
// ISDS_PASSWORD). Bez nich je ověření jen ruční (provozovatel). Tvar zpráv
// podle WSDL ISDS v20 (FindDataBox na /DS/df, CreateMessage na /DS/dz).

const NS = "http://isds.czechpoint.cz/v20";
const TIMEOUT_MS = 10_000;

export type IsdsConfig = { username: string; password: string; baseUrl: string };
type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
type Options = { config?: IsdsConfig | null; fetchImpl?: FetchImpl };

export function isdsConfiguration(env: Record<string, string | undefined> = process.env): IsdsConfig | null {
  const username = env.ISDS_USERNAME?.trim();
  const password = env.ISDS_PASSWORD;
  if (!username || !password) return null;
  const production = env.ISDS_ENV?.trim() === "production";
  return { username, password, baseUrl: production ? "https://ws1.mojedatovaschranka.cz/DS/" : "https://ws1.czebox.cz/DS/" };
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function envelope(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
}

// Prvky odpovědi bez ohledu na prefix jmenného prostoru.
function elements(xml: string, name: string) {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "g"))].map((match) => match[1]);
}
function element(xml: string, name: string) {
  return elements(xml, name)[0]?.trim() ?? null;
}
function unescapeXml(value: string) {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

async function call(service: "df" | "dz", body: string, options: Options) {
  const config = options.config === undefined ? isdsConfiguration() : options.config;
  if (!config) return { ok: false as const, reason: "not_configured" as const };
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${config.baseUrl}${service}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '""',
        Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
      },
      body: envelope(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false as const, reason: "http_error" as const };
    return { ok: true as const, xml: await response.text() };
  } catch {
    return { ok: false as const, reason: "network" as const };
  }
}

export type DataBoxLookup =
  | { status: "found"; dataBoxId: string; firmName: string | null }
  | { status: "not_found" }
  | { status: "not_configured" }
  | { status: "unavailable" };

/** Datová schránka právnické osoby s přesně tímto IČO. */
export async function findCompanyDataBox(ico: string, options: Options = {}): Promise<DataBoxLookup> {
  if (!/^\d{8}$/.test(ico)) return { status: "not_found" };
  const result = await call("df", `<FindDataBox xmlns="${NS}"><dbOwnerInfo><dbType>PO</dbType><ic>${ico}</ic></dbOwnerInfo></FindDataBox>`, options);
  if (!result.ok) return { status: result.reason === "not_configured" ? "not_configured" : "unavailable" };
  const code = element(result.xml, "dbStatusCode");
  if (code !== "0000") return { status: code === "0002" ? "not_found" : "unavailable" };
  const match = elements(result.xml, "dbOwnerInfo")
    .map((owner) => ({ id: element(owner, "dbID"), ic: element(owner, "ic"), firmName: element(owner, "firmName") }))
    .find((owner) => owner.ic === ico && owner.id && /^[a-z0-9]{7}$/i.test(owner.id));
  return match?.id
    ? { status: "found", dataBoxId: match.id.toLowerCase(), firmName: match.firmName ? unescapeXml(match.firmName) : null }
    : { status: "not_found" };
}

export type DataBoxSend = { status: "sent"; messageId: string } | { status: "not_configured" } | { status: "failed" };

/** Pošle do datové schránky jednu textovou písemnost. */
export async function sendDataBoxMessage(
  message: { dataBoxId: string; subject: string; text: string },
  options: Options = {},
): Promise<DataBoxSend> {
  if (!/^[a-z0-9]{7}$/i.test(message.dataBoxId)) return { status: "failed" };
  const content = Buffer.from(message.text, "utf8").toString("base64");
  const body = `<CreateMessage xmlns="${NS}"><dmEnvelope><dbIDRecipient>${message.dataBoxId.toLowerCase()}</dbIDRecipient><dmAnnotation>${escapeXml(message.subject.slice(0, 255))}</dmAnnotation></dmEnvelope><dmFiles><dmFile dmMimeType="text/plain" dmFileMetaType="main" dmFileDescr="overeni-splatno.txt"><dmEncodedContent>${content}</dmEncodedContent></dmFile></dmFiles></CreateMessage>`;
  const result = await call("dz", body, options);
  if (!result.ok) return { status: result.reason === "not_configured" ? "not_configured" : "failed" };
  const messageId = element(result.xml, "dmID");
  return element(result.xml, "dmStatusCode") === "0000" && messageId ? { status: "sent", messageId } : { status: "failed" };
}

/** Otisk ověřovacího kódu svázaný s firmou; v databázi je jen tohle. */
export function verificationCodeHash(params: { organizationId: string; code: string; secret: string }) {
  return createHmac("sha256", params.secret).update(`data-box-verification:${params.organizationId}:${params.code}`).digest("hex");
}
