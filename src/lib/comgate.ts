import { timingSafeEqual } from "node:crypto";

// Platební brána Comgate, REST API v2.0 (JSON, přihlášení Basic
// merchant:secret). Platba se zakládá na pozadí a zákazník se přesměruje na
// bránu. Oznámení o zaplacení (push) se ověří tajemstvím a stav se pak vždy
// znovu načte z Comgate -- samotnému oznámení se nevěří.

const BASE_URL = "https://payments.comgate.cz";
const TIMEOUT_MS = 15_000;

export type ComgateConfig = { merchant: string; secret: string; test: boolean };
type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
type Options = { config?: ComgateConfig | null; fetchImpl?: FetchImpl };

export function comgateConfiguration(env: Record<string, string | undefined> = process.env): ComgateConfig | null {
  const merchant = env.COMGATE_MERCHANT?.trim();
  const secret = env.COMGATE_SECRET?.trim();
  if (!merchant || !secret) return null;
  return { merchant, secret, test: env.COMGATE_TEST?.trim() !== "false" };
}

async function request(method: "GET" | "POST", path: string, body: unknown, options: Options) {
  const config = options.config === undefined ? comgateConfiguration() : options.config;
  if (!config) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.merchant}:${config.secret}`).toString("base64")}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const parsed = await response.json().catch(() => null) as Record<string, unknown> | null;
    return parsed && Number(parsed.code) === 0 ? { config, data: parsed } : null;
  } catch {
    return null;
  }
}

export async function createComgatePayment(
  payment: { orderId: string; priceHalere: number; label: string; email: string; returnUrl: string },
  options: Options = {},
): Promise<{ ok: true; transId: string; redirect: string } | { ok: false }> {
  const config = options.config === undefined ? comgateConfiguration() : options.config;
  if (!config) return { ok: false };
  const result = await request("POST", "/v2.0/payment.json", {
    price: payment.priceHalere,
    curr: "CZK",
    label: payment.label.slice(0, 16),
    refId: payment.orderId,
    method: "ALL",
    email: payment.email,
    test: config.test,
    country: "CZ",
    lang: "cs",
    prepareOnly: true,
    url_paid: payment.returnUrl,
    url_cancelled: payment.returnUrl,
    url_pending: payment.returnUrl,
  }, { ...options, config });
  const transId = typeof result?.data.transId === "string" ? result.data.transId : null;
  const redirect = typeof result?.data.redirect === "string" ? result.data.redirect : null;
  // Přesměrovat zákazníka smíme jen na bránu Comgate, nikam jinam.
  if (!transId || !redirect || !/^https:\/\/([a-z0-9-]+\.)*comgate\.cz\//.test(redirect)) return { ok: false };
  return { ok: true, transId, redirect };
}

export type ComgatePayment = {
  ok: true;
  status: "PAID" | "CANCELLED" | "AUTHORIZED" | "PENDING";
  priceHalere: number;
  currency: string;
  refId: string;
  transId: string;
};

export async function getComgatePayment(transId: string, options: Options = {}): Promise<ComgatePayment | { ok: false }> {
  if (!/^[A-Za-z0-9-]{4,64}$/.test(transId)) return { ok: false };
  const result = await request("GET", `/v2.0/payment/transId/${encodeURIComponent(transId)}.json`, undefined, options);
  const data = result?.data;
  const status = data?.status;
  if (!data || (status !== "PAID" && status !== "CANCELLED" && status !== "AUTHORIZED" && status !== "PENDING")) return { ok: false };
  return {
    ok: true,
    status,
    priceHalere: Number(data.price),
    currency: String(data.curr ?? ""),
    refId: String(data.refId ?? ""),
    transId: String(data.transId ?? transId),
  };
}

export function isComgateSecret(received: unknown, config: ComgateConfig | null = comgateConfiguration()) {
  if (!config || typeof received !== "string") return false;
  const a = Buffer.from(received);
  const b = Buffer.from(config.secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
