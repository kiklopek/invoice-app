import { describe, expect, it } from "vitest";
import { plural } from "./czech-plural";
import {
  behaviourLabel,
  describeNetPosition,
  formatCurrencyList,
  isLookupIco,
  netPositions,
  networkErrorMessage,
  networkTotals,
  normalizeIcoInput,
  openAmount,
  type CurrencyBalance,
  type NetworkConnection,
} from "./partner-network";

const balance = (currency: string, theyOwe: number, weOwe: number, overdue = 0): CurrencyBalance => ({
  currency, they_owe: theyOwe, we_owe: weOwe, they_overdue: overdue, we_overdue: 0, they_count: 1, we_count: 1,
});

const connection = (status: NetworkConnection["status"], balances: CurrencyBalance[]): NetworkConnection => ({
  id: crypto.randomUUID(), status, direction: "outgoing", origin: "search", message: null,
  created_at: "2026-10-01T10:00:00Z", activated_at: status === "active" ? "2026-10-02T10:00:00Z" : null,
  requested_by_email: null, partner: { id: "p", name: "Beta a.s.", ico: "12345610", dic: null, address: null, logo_path: null },
  balances, open_flags: 0, preview: null,
});

describe("čistá pozice mezi partnery", () => {
  it("nets per currency and never mixes CZK with EUR", () => {
    const positions = netPositions([balance("EUR", 0, 4000), balance("CZK", 12500, 2500)]);
    expect(positions).toEqual([
      expect.objectContaining({ currency: "CZK", net: 10000, direction: "they_owe" }),
      expect.objectContaining({ currency: "EUR", net: -4000, direction: "we_owe" }),
    ]);
  });

  it("calls an even balance settled and rounds to haléře", () => {
    expect(netPositions([balance("CZK", 100.1, 100.1)])[0].direction).toBe("settled");
    expect(netPositions([balance("CZK", 0.3, 0.1)])[0].net).toBe(0.2);
  });

  it("describes who owes whom in plain Czech", () => {
    const [czk, eur] = netPositions([balance("CZK", 12500, 2500), balance("EUR", 0, 4000)]);
    expect(describeNetPosition(czk, "Beta a.s.").replace(/\s/g, " ")).toBe("Beta a.s. vám dluží 10 000 Kč");
    expect(describeNetPosition(eur, "Beta a.s.").replace(/\s/g, " ")).toBe("Dlužíte firmě Beta a.s. 4 000 €");
  });

  it("sums only active connections across the whole network", () => {
    const totals = networkTotals([
      connection("active", [balance("CZK", 1000, 200, 300)]),
      connection("active", [balance("CZK", 500, 0), balance("EUR", 0, 50)]),
      connection("pending", [balance("CZK", 99999, 0)]),
    ]);
    expect(totals.find((total) => total.currency === "CZK")).toMatchObject({ they_owe: 1500, we_owe: 200, they_overdue: 300 });
    expect(totals.find((total) => total.currency === "EUR")).toMatchObject({ we_owe: 50 });
  });

  it("lists amounts per currency like the dashboard does", () => {
    expect(formatCurrencyList([{ currency: "CZK", amount: 1000 }, { currency: "EUR", amount: 200 }]).replace(/\s/g, " ")).toBe("1 000 Kč + 200 €");
    expect(formatCurrencyList([{ currency: "CZK", amount: 0 }]).replace(/\s/g, " ")).toBe("0 Kč");
  });

  it("computes the open amount without going negative", () => {
    expect(openAmount({ amount: 1210, paid_amount: 210.5 })).toBe(999.5);
    expect(openAmount({ amount: 100, paid_amount: 120 })).toBe(0);
  });
});

describe("pomocníci sítě", () => {
  it("accepts IČO typed with spaces but only with a valid check digit", () => {
    expect(normalizeIcoInput("270 82 440")).toBe("27082440");
    expect(isLookupIco("270 82 440")).toBe(true);
    expect(isLookupIco("12345678")).toBe(false);
  });

  it("describes payment behaviour", () => {
    expect(behaviourLabel({ paid_count: 0, avg_days_late: null, on_time_share: null })).toBe("Zatím bez zaplacených faktur");
    expect(behaviourLabel({ paid_count: 5, avg_days_late: 0.2, on_time_share: 1 })).toBe("Platí včas");
    expect(behaviourLabel({ paid_count: 5, avg_days_late: 3.4, on_time_share: 0.4 })).toBe("Průměrně 3 dny po splatnosti");
    expect(behaviourLabel({ paid_count: 5, avg_days_late: 12, on_time_share: 0 })).toBe("Průměrně 12 dní po splatnosti");
  });

  it("translates every database refusal into an actionable Czech sentence", () => {
    expect(networkErrorMessage("ico_mismatch")).toMatchObject({ status: 409, code: "ico_mismatch" });
    expect(networkErrorMessage("recently_declined")?.message).toContain("30 dní");
    expect(networkErrorMessage("insufficient_permission")?.status).toBe(403);
    expect(networkErrorMessage("something unexpected")).toBeNull();
    expect(networkErrorMessage(null)).toBeNull();
  });

  it("declines Czech nouns for counts", () => {
    expect(plural(1, "partner", "partneři", "partnerů")).toBe("1 partner");
    expect(plural(3, "partner", "partneři", "partnerů")).toBe("3 partneři");
    expect(plural(0, "partner", "partneři", "partnerů")).toBe("0 partnerů");
    expect(plural(12, "partner", "partneři", "partnerů")).toBe("12 partnerů");
  });
});
