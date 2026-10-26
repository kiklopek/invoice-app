// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { useInvalidateWorkspaceData } from "@/lib/workspace-cache";
import {
  emptyDashboardData,
  type DashboardData,
} from "@/lib/dashboard-summary";
import { DashboardClient } from "./dashboard-client";

const state = vi.hoisted(() => ({ role: "admin", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push }),
  usePathname: () => "/dashboard",
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement("a", props, children),
}));
vi.mock("@/components/layout/app-shell", async () => {
  const { WorkspaceTopbar } = await import("@/components/layout/workspace-topbar");
  return {
  AppFrame: ({
    children,
    className,
    topbar,
  }: {
    children: React.ReactNode;
    className: string;
    topbar?: React.ReactNode;
  }) => <main className={className}>{topbar === undefined ? <WorkspaceTopbar /> : topbar}{children}</main>,
  };
});
vi.mock("@/lib/use-access-role", () => ({
  useAccessProfile: () => ({ role: state.role, name: "Anna Nováková" }),
}));
vi.mock("@/lib/revalidate-on-revisit", () => ({
  useRevalidateOnRevisit: () => false,
}));

let root: Root;
let container: HTMLDivElement;
function InvalidateTrigger() {
  const invalidate = useInvalidateWorkspaceData();
  return (
    <button id="invalidate-fixture" onClick={() => void invalidate()}>
      Invalidate fixture
    </button>
  );
}
let failSnapshot: boolean;
let failureStatus: number;
let urls: string[];
const data: DashboardData = {
  ...emptyDashboardData,
  active_count: 25,
  overdue_count: 7,
  open_totals: { CZK: 1340000, EUR: 2000 },
  overdue_totals: { CZK: 320000 },
  paid_totals: { CZK: 1980000 },
  reminders_sent: 12,
  payments_needing_review: 4,
};
const snapshotFields = {
  invoice_count: 124,
  paid_invoice_count: 99,
  previous_invoice_count: null,
  currencies: ["CZK", "EUR"],
  charts: Object.fromEntries(["CZK", "EUR"].map(currency => [currency, {
    monthly: [{ key: "2026-10", issued: 125000, paid: 50000, count: 3 }],
    statuses: {
      paid: { monthly: [{ key: "2026-10", issued: 40000, paid: 40000, count: 1 }] },
      pending: { monthly: [{ key: "2026-10", issued: 50000, paid: 10000, count: 1 }] },
      overdue: { monthly: [{ key: "2026-10", issued: 35000, paid: 0, count: 1 }] },
    },
  }])),
};
beforeEach(() => {
  state.role = "admin";
  state.push.mockReset();
  failSnapshot = false;
  failureStatus = 503;
  urls = [];
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      urls.push(url);
      if (url === "/api/settings/reminders")
        return new Response(JSON.stringify({ active: true }));
      const detailMatch = url.match(/^\/api\/invoices\/([^/]+)\/page-data$/);
      if (detailMatch)
        return new Response(
          JSON.stringify({
            invoice: {
              id: detailMatch[1],
              invoice_number: `FV-${detailMatch[1]}`,
              counterparty_name: "Firma 0",
              status: "pending",
              reminders_paused: false,
              reminders_sent: 1,
              amount: 125000,
              currency: "CZK",
              next_reminder_at: "2026-10-18T08:00:00Z",
            },
            can_manage: true,
            suppression: null,
            reminders: ["escalation", "overdue", "on_due", "before_due"].map(
              (stage, index) => ({
                id: `reminder-${index}`,
                stage,
                status: index === 0 ? "sent" : "skipped",
                scheduled_for: "2026-10-18T08:00:00Z",
                sent_at: "2026-10-18T08:00:00Z",
                sent_to: "kontakt@example.invalid",
                delivery_status: "delivered",
                delivered_at: "2026-10-18T08:00:00Z",
              }),
            ),
          }),
        );
      if (url.startsWith("/api/notifications")) return new Response(JSON.stringify({ items: [], unread_count: 0, total: 0, has_more: false, next_cursor: null, through: "2026-10-23T10:00:00Z" }));
      if (url.startsWith("/api/dashboard?")) {
        if (failSnapshot) return new Response(JSON.stringify({ error: "Unavailable" }), { status: failureStatus });
        const params = new URL(url, "http://fixture.test").searchParams;
        const small = params.get("from") === "2026-08-01";
        return new Response(
          JSON.stringify({
            ...data,
            ...(small
              ? {
                  active_count: 2,
                  overdue_count: 1,
                  open_totals: { CZK: 300 },
                  overdue_totals: { CZK: 100 },
                  paid_totals: { CZK: 200 },
                  reminders_sent: 3,
                }
              : {}),
            period: { from: params.get("from"), to: params.get("to") },
            ...snapshotFields,
            previous_invoice_count: small ? 110 : null,
            report_from: params.get("from") ?? "2020-02-01",
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(summary = data, fields = snapshotFields) {
  await act(async () => {
    root.render(
      <SWRConfig
        value={{
          provider: () => new Map(),
          fetcher: (key: string) => apiFetch(key),
          shouldRetryOnError: false,
          revalidateOnFocus: false,
        }}
      >
        <DashboardClient
          initialData={{
            ...summary,
            ...fields,
            period: { from: null, to: "2026-10-17" },
            report_from: "2020-02-01",
          }}
          initialNow="2026-10-17T08:00:00Z"
        />
        <InvalidateTrigger />
      </SWRConfig>,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

describe("dashboard UI with one server snapshot", () => {
  it("reads full server counts and keeps overdue within the active total", async () => {
    await render();
    expect(urls.filter(url => /^\/api\/(dashboard|invoices|reports)/.test(url))).toEqual([]);
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("all");
    expect(urls.some((url) => url.startsWith("/api/invoices?from="))).toBe(false);
    expect(container.textContent).toContain("Za celé období");
    expect(container.textContent).toContain("124");
    expect(container.textContent).toContain(
      "25 faktur čeká na úplnou úhradu, z toho 7 po splatnosti",
    );
    expect(container.textContent).toContain("Nezaplacené, splatné dnes nebo později");
    const waiting = container.querySelector('article[data-tone="waiting"]')!;
    const overdue = container.querySelector('article[data-tone="overdue"]')!;
    expect(waiting.querySelector("strong")?.textContent).toBe("18");
    expect(overdue.querySelector("strong")?.textContent).toBe("7");
    expect(waiting.querySelector('[data-money-main]')?.getAttribute("aria-label")).toBe("1 020 000,00 Kč");
    expect(overdue.querySelector('[data-money-main]')?.getAttribute("aria-label")).toBe("320 000,00 Kč");
    expect(container.textContent).toContain("Částka včetně částečných úhrad");
    expect(container.textContent).toContain("EUR");
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.textContent).not.toContain("Tomáši");
  });

  it("focuses search through the displayed keyboard shortcut", async () => {
    await render();
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement?.id).toBe("dashboard-search");
  });
  it("copies an invoice number from its action menu without opening the invoice", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });
    await render({
      ...data,
      recent: [
        {
          id: "copy-1",
          invoice_number: "FV-copy",
          variable_symbol: null,
          counterparty_name: "Firma",
          counterparty_email: "a@example.invalid",
          amount: 100,
          paid_amount: 0,
          currency: "CZK",
          due_date: "2026-10-18",
          status: "pending",
          reminders_sent: 0,
          created_at: "2026-10-10T08:00:00Z",
        },
      ],
    });
    const menu = container.querySelector<HTMLDetailsElement>(
      'details[data-dashboard-popup]:has(a[href="/invoices/copy-1"])',
    )!;
    menu.open = true;
    await act(async () =>
      menu.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(copy).toHaveBeenCalledWith("FV-copy");
    expect(state.push).not.toHaveBeenCalled();
    expect(menu.textContent).toContain("Zkopírováno");
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(menu.open).toBe(false);
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("loads one snapshot per period while currency switching makes no requests", async () => {
    await render();
    await act(async () => {
      const period = container.querySelector<HTMLSelectElement>("select")!;
      period.value = "3";
      period.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(urls.filter(url => /^\/api\/(dashboard|invoices|reports)/.test(url))).toEqual(["/api/dashboard?from=2026-08-01&to=2026-10-17"]);
    const requestsBeforeCurrency = urls.length;
    await act(async () => {
      const currency = container.querySelector<HTMLSelectElement>('select[aria-label="Měna grafu"]')!;
      currency.value = "EUR";
      currency.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(urls).toHaveLength(requestsBeforeCurrency);
    expect(container.textContent).toContain("2 faktur čeká");
    expect(container.textContent).toContain("3 odesláno");
    expect(container.textContent).toContain("200,00 Kč");
    expect(container.textContent).not.toContain("1 340 000,00 Kč");
  });

  it("renders historical chart and counts from server data without follow-up report requests", async () => {
    await render();
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("all");
    expect(urls.some(url => url.startsWith("/api/reports") || url.startsWith("/api/invoices?"))).toBe(false);
    expect(container.querySelector('[aria-label="Měsíční částky faktur"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Načítání srovnání");
    expect(container.querySelector('a[href="/invoices?status=overdue&to=2026-10-17"]')).not.toBeNull();
  });

  it("does not display the previous period's balances while a new period loads", async () => {
    await render();
    const originalFetch = globalThis.fetch;
    let release!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/dashboard?from=2026-08-01&to=2026-10-17") {
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
        return originalFetch(input, init);
      }),
    );
    await act(async () => {
      const period = container.querySelector<HTMLSelectElement>("select")!;
      period.value = "3";
      period.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.textContent).toContain("Načítání dat za vybrané období");
    expect(container.textContent).not.toContain("1 340 000");
    expect(
      container.querySelector('[aria-label="Souhrn pohledávek"]'),
    ).toBeNull();
    await act(async () => {
      release(
        new Response(
          JSON.stringify({ ...data, active_count: 1, overdue_count: 0 }),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(container.textContent).toContain("1 faktur čeká");
  });

  it("offers retry without presenting old data when the selected period fails", async () => {
    await render();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/dashboard?from=2026-08-01&to=2026-10-17")
          return Promise.resolve(
            new Response(JSON.stringify({ error: "Unavailable" }), {
              status: 503,
            }),
          );
        return originalFetch(input, init);
      }),
    );
    await act(async () => {
      const period = container.querySelector<HTMLSelectElement>("select")!;
      period.value = "3";
      period.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "Přehled se nepodařilo aktualizovat",
    );
    expect(container.textContent).not.toContain("1 340 000");
    vi.stubGlobal("fetch", originalFetch);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[role="alert"] button')!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(container.textContent).toContain("2 faktur čeká");
  });

  it("refreshes every chart and counter together through workspace invalidation", async () => {
    await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#invalidate-fixture")!.click();
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(urls.filter(url => url.startsWith("/api/dashboard?"))).toEqual(["/api/dashboard?to=2026-10-17"]);
    expect(urls.some(url => url.startsWith("/api/reports"))).toBe(false);
    expect(container.querySelector('[aria-label="Měsíční částky faktur"]')).not.toBeNull();
  });

  it("keeps viewer insights while removing operational links", async () => {
    state.role = "viewer";
    await render();
    expect(container.querySelector('a[href="/invoices/import"]')).toBeNull();
    expect(container.querySelector('a[href="/invoices/new"]')).toBeNull();
    expect(container.querySelector('a[href="/invoices/payments"]')).toBeNull();
    expect(container.querySelector('a[href="/reminders"]')).toBeNull();
    expect(container.querySelector('a[href="/reports"]')).not.toBeNull();
  });

  it("retains the last successful balances when a background refresh fails and offers retry", async () => {
    await render();
    failSnapshot = true;
    await act(async () => {
      container.querySelector<HTMLButtonElement>("#invalidate-fixture")!.click();
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(container.textContent).toContain("Přehled se nepodařilo aktualizovat");
    expect(container.textContent).toContain("Poslední faktury");
    expect(container.textContent).toContain("25 faktur čeká");
    failSnapshot = false;
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(container.textContent).not.toContain("Přehled se nepodařilo aktualizovat");
    expect(container.querySelector('[aria-label="Měsíční částky faktur"]')).not.toBeNull();
  });

  it("uses one consistent snapshot for every chart status including partial receipts", async () => {
    await render();
    const month = container.querySelector('[tabindex="0"][aria-label^="2026-10"]');
    expect(month?.getAttribute("aria-label")).toContain("uhrazeno bez storen 50 000");
    expect(month?.getAttribute("aria-label")).toContain("čeká na úhradu 40 000");
    expect(month?.getAttribute("aria-label")).toContain("po splatnosti 35 000");
  });

  it("shows an empty chart for an unused currency without changing invoice counts", async () => {
    await render(data, { ...snapshotFields, charts: { EUR: snapshotFields.charts.EUR } });
    expect(container.textContent).toContain("Ve zvoleném období a měně nejsou žádné faktury");
    expect(container.textContent).toContain("124");
    expect(container.textContent).not.toContain("Začněte první fakturou");
  });

  it("provides accurate keyboard chart values without changing the money data", async () => {
    await render();
    const point = container.querySelector(
      '[tabindex="0"][aria-label^="2026-10:"]',
    );
    expect(point?.getAttribute("aria-label")).toContain("125 000");
    expect(point?.getAttribute("aria-label")).toContain("50 000");
    expect(
      container.querySelector("details[data-chart-values] summary")
        ?.textContent,
    ).toContain("Zobrazit hodnoty grafu");
  });

  it("limits previews and shows a role-safe company reminder overview", async () => {
    state.role = "viewer";
    const invoices = Array.from({ length: 8 }, (_, index) => ({
      id: `invoice-${index}`,
      invoice_number: `FV-${index}`,
      variable_symbol: null,
      counterparty_name: `Firma ${index}`,
      counterparty_email: "kontakt@example.invalid",
      amount: 125000,
      paid_amount: 25000,
      currency: "CZK",
      due_date: "2026-10-18",
      status: "pending" as const,
      reminders_sent: 0,
      created_at: "2026-10-10T08:00:00Z",
      next_reminder_at: `2026-10-${String(18 + index).padStart(2, "0")}T08:00:00Z`,
    }));
    await render({ ...data, recent: invoices, upcoming: invoices });
    const recent = container
      .querySelector("#dashboard-invoices-heading")!
      .closest("section")!;
    const upcoming = container
      .querySelector("#dashboard-reminders-heading")!
      .closest("aside")!;
    expect(recent.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(
      recent.querySelector('a[href="/invoices?to=2026-10-17"]'),
    ).not.toBeNull();
    expect(upcoming.querySelectorAll("ul li")).toHaveLength(8);
    expect(
      upcoming.querySelector('a[href="/invoices/invoice-0"]'),
    ).not.toBeNull();
    expect(
      upcoming.querySelector('a[href="/invoices/invoice-2"]'),
    ).not.toBeNull();
    expect(upcoming.querySelector('a[href="/invoices/invoice-3"]')).not.toBeNull();
    expect(upcoming.querySelector("select,ol")).toBeNull();
    expect(upcoming.querySelector('a[href="/reminders"]')).toBeNull();
    expect(urls).not.toContain("/api/settings/reminders");
  });

  it("automatically recovers a transient snapshot failure", async () => {
    await render();
    vi.useFakeTimers();
    try {
      failSnapshot = true;
      await act(async () => {
        const period = container.querySelector<HTMLSelectElement>("select")!;
        period.value = "3";
        period.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(container.textContent).toContain("Přehled se nepodařilo aktualizovat");
      failSnapshot = false;
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(container.textContent).toContain("2 faktur čeká");
      expect(container.textContent).not.toContain("Přehled se nepodařilo aktualizovat");
      expect(urls.filter(url => url.startsWith("/api/dashboard?"))).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it("does not retry permission failures", async () => {
    await render();
    vi.useFakeTimers();
    try {
      failSnapshot = true;
      failureStatus = 403;
      await act(async () => {
        const period = container.querySelector<HTMLSelectElement>("select")!;
        period.value = "3";
        period.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(urls.filter(url => url.startsWith("/api/dashboard?"))).toHaveLength(1);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("bounds automatic retries when a transient failure persists", async () => {
    await render();
    vi.useFakeTimers();
    try {
      failSnapshot = true;
      await act(async () => {
        const period = container.querySelector<HTMLSelectElement>("select")!;
        period.value = "3";
        period.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(urls.filter(url => url.startsWith("/api/dashboard?"))).toHaveLength(3);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("lets users select invoice text without opening the invoice", async () => {
    await render({
      ...data,
      recent: [
        {
          id: "invoice-1",
          invoice_number: "FV-2026-001",
          variable_symbol: "2026001",
          counterparty_name: "Ukázková firma",
          counterparty_email: "kontakt@example.invalid",
          amount: 125000,
          paid_amount: 30000,
          currency: "CZK",
          due_date: "2026-10-18",
          status: "pending",
          reminders_sent: 2,
          created_at: "2026-10-10T08:00:00Z",
        },
      ],
    });
    const row = container
      .querySelector("#dashboard-invoices-heading")!
      .closest("section")!
      .querySelector<HTMLTableRowElement>("tbody tr")!;
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "Ukázková firma",
    } as Selection);
    await act(async () =>
      row
        .querySelector("strong")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(state.push).not.toHaveBeenCalled();
    vi.mocked(window.getSelection).mockReturnValue(null);
    await act(async () =>
      row
        .querySelector("strong")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(state.push).toHaveBeenCalledWith("/invoices/invoice-1");
    expect(container.textContent).toContain("Částečně uhrazeno");
  });
});
