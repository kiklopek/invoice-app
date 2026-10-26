// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig, type Cache } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardReminderOverview } from "./dashboard-reminders";
import {
  emptyDashboardData,
  type DashboardData,
} from "@/lib/dashboard-summary";
import { apiFetch } from "@/lib/api-client";
vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
let root: Root, container: HTMLDivElement;
let active: boolean,
  paused: boolean,
  suppressed: boolean,
  failSettings: boolean,
  failDetail: boolean;
let reads: string[], writes: string[];
const choices = ["first", "second", "third", "fourth"].map((id, i) => ({
  id,
  invoice_number: `FV-${id}`,
  counterparty_name: `Firma ${id}`,
  amount: 1000 + i,
  paid_amount: 0,
  currency: "CZK",
  status: "pending" as const,
  next_reminder_at: `2026-10-${18 + i}T08:00:00Z`,
}));
let summary: DashboardData;
let cache: Cache<unknown>;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  active = true;
  paused = false;
  suppressed = false;
  failSettings = false;
  failDetail = false;
  reads = [];
  writes = [];
  cache = new Map();
  summary = {
    ...emptyDashboardData,
    reminders_sent: 27,
    upcoming: [...choices].reverse(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (init?.method && init.method !== "GET") {
        writes.push(url);
        return new Response("{}", { status: 405 });
      }
      reads.push(url);
      if (url === "/api/settings/reminders")
        return new Response(
          JSON.stringify(failSettings ? { error: "Nedostupné" } : { active }),
          { status: failSettings ? 500 : 200 },
        );
      const id = url.split("/")[3];
      return new Response(
        JSON.stringify(
          failDetail
            ? { error: "Nedostupné" }
            : {
                invoice: {
                  ...choices.find((item) => item.id === id),
                  reminders_paused: paused,
                  reminders_sent: 2,
                },
                can_manage: true,
                suppression: suppressed ? { reason: "bounced" } : null,
                reminders: [],
              },
        ),
        { status: failDetail ? 500 : 200 },
      );
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(canManage = true, today = "2026-10-17") {
  await act(async () => {
    root.render(
      <SWRConfig
        value={{
          provider: () => cache,
          fetcher: (key: string) => apiFetch(key),
          shouldRetryOnError: false,
          revalidateOnFocus: false,
        }}
      >
        <DashboardReminderOverview
          summary={summary}
          canManage={canManage}
          today={today}
        />
      </SWRConfig>,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}
describe("company upcoming reminders overview", () => {
  it("shows all loaded distinct schedules in send order, company totals and invoice links", async () => {
    summary.upcoming.push(choices[0]);
    await render();
    const items = [...container.querySelectorAll("ul li")];
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain("Firma first");
    expect(items[3].textContent).toContain("Firma fourth");
    expect(container.textContent).toContain("27 odesláno");
    expect(container.querySelector("h2")!.textContent).toBe(
      "Nejbližší upomínky",
    );
    expect(
      container
        .querySelector("[data-reminder-scroll]")!
        .getAttribute("tabindex"),
    ).toBe("0");
    expect(container.querySelector("h3")).toBeNull();
    expect(container.textContent).not.toContain("naplánované");
    expect(container.textContent).not.toContain("Spravovat");
    expect(container.textContent).not.toContain("Naplánováno");
    expect(container.querySelector("footer")).toBeNull();
    expect(container.textContent).not.toContain("Zobrazit všechny upomínky");
    expect(container.querySelector('a[href="/invoices/first"]')).not.toBeNull();
    expect(reads.filter((url) => url.includes("/page-data"))).toHaveLength(4);
    expect(reads).toContain("/api/invoices/fourth/page-data");
    expect(container.querySelector("ol,select,details")).toBeNull();
    expect(
      container.querySelector('button[aria-label^="Pozastavit"]'),
    ).toBeNull();
    expect(writes).toEqual([]);
    expect(items[0].querySelectorAll("time")).toHaveLength(1);
    expect(items[0].textContent).toContain("1 000,00 Kč");
  });
  it.each(["company", "invoice", "email"])(
    "shows attention instead of an active schedule when blocked by %s",
    async (reason) => {
      active = reason !== "company";
      paused = reason === "invoice";
      suppressed = reason === "email";
      await render();
      const item = container.querySelector("li")!;
      expect(item.getAttribute("data-attention")).toBe("true");
      expect(item.textContent).not.toContain("Naplánováno");
      expect(item.querySelector("a")!.getAttribute("title")).toBe(
        reason === "company"
          ? "Automat pozastavený"
          : reason === "invoice"
            ? "Pozastaveno u faktury"
            : "Zkontrolujte e-mail",
      );
    },
  );
  it("only loads extra invoice details when their rows approach the visible scroll area", async () => {
    const callbacks: Array<
      (entries: Array<{ isIntersecting: boolean }>) => void
    > = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (entries: Array<{ isIntersecting: boolean }>) => void,
        ) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    await render();
    expect(container.querySelectorAll("ul li")).toHaveLength(4);
    expect(reads).not.toContain("/api/invoices/fourth/page-data");
    await act(async () => {
      callbacks.forEach((callback) => callback([{ isIntersecting: true }]));
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(reads).toContain("/api/invoices/fourth/page-data");
  });
  it("does not read privileged settings or link to operations for a viewer", async () => {
    await render(false);
    expect(reads).not.toContain("/api/settings/reminders");
    expect(container.querySelector('a[href="/reminders"]')).toBeNull();
    expect(container.querySelector('a[href="/invoices/first"]')).not.toBeNull();
    expect(container.querySelectorAll("ul li")).toHaveLength(4);
    expect(container.querySelector("li a")!.getAttribute("title")).toBe(
      "Plán evidovaný",
    );
  });
  it("does not claim automation is active when settings fail", async () => {
    failSettings = true;
    await render();
    expect(container.textContent).toContain("Stav automatu nelze ověřit");
    expect(container.textContent).not.toContain(
      "Automatické odesílání aktivní",
    );
    expect(container.querySelector("li a")!.getAttribute("title")).toBe(
      "Plán evidovaný",
    );
  });
  it("reports an unverified invoice state and can retry without mutations", async () => {
    failDetail = true;
    await render();
    expect(container.querySelector("li a")!.getAttribute("title")).toBe(
      "Stav nelze ověřit",
    );
    failDetail = false;
    await act(async () => {
      container.querySelector<HTMLButtonElement>("li button")!.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(container.querySelector("li a")!.getAttribute("title")).toBe(
      "Naplánováno",
    );
    expect(writes).toEqual([]);
  });
  it("marks today in Prague and distinguishes overdue schedules from future reminders", async () => {
    summary.upcoming = [
      { ...choices[0], next_reminder_at: "2026-10-17T22:30:00Z" },
      choices[1],
      choices[2],
    ];
    await render(true, "2026-10-18");
    const items = [...container.querySelectorAll("ul li")];
    expect(items[0].querySelector("a")!.getAttribute("data-tone")).toBe(
      "today",
    );
    expect(items[1].querySelector("a")!.getAttribute("data-tone")).toBe(
      "scheduled",
    );
    expect(container.querySelector("h3")).toBeNull();
    expect(container.textContent).not.toContain("naplánované");
  });
  it("does not label a missed schedule as scheduled in the future", async () => {
    await render(true, "2026-10-19");
    expect(container.querySelector("li a")!.getAttribute("title")).toBe(
      "Čeká na odeslání",
    );
  });
  it("keeps the scrollable schedule available on short desktops", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      })),
    );
    await render();
    expect(container.querySelectorAll("ul li")).toHaveLength(4);
    expect(container.querySelector("h3")).toBeNull();
    expect(container.textContent).not.toContain("naplánované");
    expect(reads).toContain("/api/invoices/third/page-data");
    expect(container.querySelector("footer")).toBeNull();
  });
  it("does not show a previous invoice's detail while a replacement row loads", async () => {
    summary.upcoming = choices.slice(0, 3);
    await render();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/invoices/fourth/page-data")
          return new Promise<Response>(() => {});
        return originalFetch(input, init);
      }),
    );
    summary = {
      ...summary,
      upcoming: [
        { ...choices[3], next_reminder_at: "2026-10-17T07:00:00Z" },
        choices[1],
        choices[2],
      ],
    };
    await render();
    const first = container.querySelector("li")!;
    expect(first.textContent).toContain("Firma fourth");
    expect(first.textContent).not.toContain("Firma first");
    expect(first.querySelector("a")!.getAttribute("href")).toBe(
      "/invoices/fourth",
    );
    expect(first.querySelector("a")!.getAttribute("title")).toBe(
      "Ověřuji stav…",
    );
  });
  it("shows a truthful empty state and ignores invalid or closed schedule candidates", async () => {
    summary.upcoming = [
      { ...choices[0], next_reminder_at: "invalid" },
      { ...choices[1], status: "paid" },
    ];
    await render();
    expect(container.textContent).toContain(
      "Žádné další upomínky nejsou naplánované.",
    );
    expect(container.querySelector("ul")).toBeNull();
    expect(reads.filter((url) => url.includes("/page-data"))).toHaveLength(0);
  });
});
