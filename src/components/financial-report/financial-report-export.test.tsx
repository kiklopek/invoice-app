// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportQuery } from "@/lib/report-query";
import { FinancialReportExport } from "./financial-report-export";

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="pdf-preview" /> }));
vi.mock("@/components/modal", () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
}));

const query: ReportQuery = {
  from: "2026-01-01",
  to: "2026-03-31",
  currency: "CZK",
  dateBasis: "issue_date",
  status: null,
  customer: null,
} as ReportQuery;

let root: Root;
let container: HTMLDivElement;
let requests: Array<{ body: Record<string, unknown>; signal: AbortSignal }>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    requests.push({ body: JSON.parse(String(init.body)), signal: init.signal as AbortSignal });
    return new Response("%PDF-1.7", {
      headers: { "content-type": "application/pdf", "x-report-pages": "3" },
    });
  }));
  URL.createObjectURL = vi.fn(() => "blob:report");
  URL.revokeObjectURL = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function open() {
  await act(async () => root.render(
    <FinancialReportExport query={query} currencies={["CZK"]} customers={[]} ready exporting={false} onExcel={async () => {}} />,
  ));
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Exportovat report"]')!.click());
  await flush();
}
const radio = (label: string) =>
  [...container.querySelectorAll<HTMLLabelElement>("label")].find((l) => l.textContent?.startsWith(label))!.querySelector("input")!;
const checkbox = (label: string) =>
  [...container.querySelectorAll<HTMLLabelElement>("label")].find((l) => l.textContent?.trim() === label)!.querySelector("input")!;
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label)!;

describe("financial report export", () => {
  it("applies the chosen report type to the content options", async () => {
    await open();
    await act(async () => radio("Souhrnný report").click());
    expect(checkbox("Zahrnout detailní tabulky").checked).toBe(false);
    expect(checkbox("Rozpis podle odběratelů").checked).toBe(false);
    for (const section of ["Tržby", "DPH", "Pohledávky", "Platby"]) expect(checkbox(section).checked).toBe(true);

    await act(async () => checkbox("DPH").click());
    await act(async () => radio("Detailní report").click());
    expect(checkbox("DPH").checked).toBe(true);
    expect(checkbox("Zahrnout detailní tabulky").checked).toBe(true);
    expect(checkbox("Rozpis podle odběratelů").checked).toBe(false);

    await act(async () => radio("Kompletní finanční report").click());
    expect(checkbox("Rozpis podle odběratelů").checked).toBe(true);

    // Vlastní report keeps whatever the user picked.
    await act(async () => checkbox("Platby").click());
    await act(async () => radio("Vlastní report").click());
    expect(checkbox("Platby").checked).toBe(false);
    expect(checkbox("Rozpis podle odběratelů").checked).toBe(true);
  });

  it("refreshes the preview by itself after a change, without a stale-settings notice", async () => {
    await open();
    expect(requests).toHaveLength(1);
    await act(async () => radio("Souhrnný report").click());
    expect(container.textContent).not.toContain("Nastavení se změnilo");
    // Stale PDF is never offered for download or print.
    expect(button("Stáhnout PDF").disabled).toBe(true);
    expect(button("Tisknout PDF").disabled).toBe(true);
    await flush(1000);
    expect(requests).toHaveLength(2);
    expect(requests[1].body).toMatchObject({ options: { mode: "summary", details: false, customers: false } });
    expect(button("Stáhnout PDF").disabled).toBe(false);
  });

  it("sends one request for a burst of changes and drops a superseded one", async () => {
    await open();
    await act(async () => radio("Souhrnný report").click());
    await flush(200);
    await act(async () => checkbox("Zahrnout grafy").click());
    await flush(200);
    await act(async () => checkbox("DPH").click());
    await flush(1000);
    expect(requests).toHaveLength(2);
    expect(requests[1].body).toMatchObject({ options: { mode: "summary", charts: false, sections: ["revenue", "receivables", "payments"] } });

    // A change while a PDF is being built aborts it and builds the newest one.
    let release!: () => void;
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async (_url: string, init: RequestInit) => {
      requests.push({ body: JSON.parse(String(init.body)), signal: init.signal as AbortSignal });
      await new Promise<void>((resolve) => { release = resolve; });
      return new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } });
    });
    await act(async () => checkbox("Zahrnout grafy").click());
    await flush(1000);
    expect(requests).toHaveLength(3);
    await act(async () => checkbox("DPH").click());
    await flush(1000);
    expect(requests[2].signal.aborted).toBe(true);
    expect(requests).toHaveLength(4);
    expect(requests[3].body).toMatchObject({ options: { charts: true } });
    // The server orders sections itself; the newest request carries all four again.
    expect([...(requests[3].body.options as { sections: string[] }).sections].sort()).toEqual(["payments", "receivables", "revenue", "vat"]);
    release();
    await flush();
    expect(button("Stáhnout PDF").disabled).toBe(false);
  });

  it("keeps the settings editable while a new preview is being built", async () => {
    await open();
    // The rebuild after the change never finishes in this test.
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => radio("Souhrnný report").click());
    await flush(1000);
    expect(container.textContent).toContain("Aktualizuji náhled");
    expect(container.querySelector('[data-testid="pdf-preview"]')).not.toBeNull();
    for (const fieldset of container.querySelectorAll("fieldset")) expect(fieldset.disabled).toBe(false);
  });

  it("does not rebuild the PDF it is already building when the dialog opens", async () => {
    let release!: () => void;
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async (_url: string, init: RequestInit) => {
      requests.push({ body: JSON.parse(String(init.body)), signal: init.signal as AbortSignal });
      await new Promise<void>((resolve) => { release = resolve; });
      return new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } });
    });
    await open();
    await flush(2000);
    expect(requests).toHaveLength(1);
    expect(requests[0].signal.aborted).toBe(false);
    release();
    await flush();
    expect(button("Stáhnout PDF").disabled).toBe(false);
  });
});
