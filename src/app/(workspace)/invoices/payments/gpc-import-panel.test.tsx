// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch:vi.fn(),confirm:vi.fn() }));
vi.mock("@/lib/api-client",() => ({ apiFetch:mocks.fetch,ApiRequestError:class extends Error {} }));
vi.mock("@/lib/confirm-action",() => ({ confirmAction:mocks.confirm }));
vi.mock("@/components/layout/app-shell", () => ({ AppFrame: ({ children, className }: { children: React.ReactNode; className?: string }) => React.createElement("main", { className }, children) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement("a", { href }, children) }));
import { GpcImportPanel } from "./gpc-import-panel";
import { PaymentsClient } from "./payments-client";
const entry = { id:"entry",line_number:1,fingerprint:"fingerprint",disposition:"accepted",reason:null,amount:100,currency:"CZK",booked_on:"2026-10-03",variable_symbol:null,counterparty_name:"Customer",counterparty_account:null,counterparty_account_verified:false,proposal_kind:"manual",proposal_confidence:"review",proposal_reason:null,proposed_invoice_ids:[] };
const preview = { import:{ id:"statement",revision:1,duplicate:false,status:"review" },account_mismatch:false,statement_account:null,expected_account:null,totals:{ accepted:1,ignored:0,errors:0 },entries:[entry],proposal_invoices:[],total_entries:1,request_id:"test" };
const detail = { ...preview,progress:{ booked:0,errors:0,remaining:1 },match_reasons:{},allocations:[],total:1 };
let host: HTMLDivElement,root: Root;
let result: { status:string;remaining:number;errors:Array<{ line_number:number;code:string }> };
const committed = vi.fn();
async function uploadFiles(names = ["test.gpc"]) {
  const input = host.querySelector('input[type="file"]')!;
  Object.defineProperty(input,"files",{ configurable:true,value:names.map(name => new File(["test"],name)) });
  await act(async () => { input.dispatchEvent(new Event("change",{ bubbles:true })); });
}
async function click(label: string) {
  let button = [...host.querySelectorAll("button")].find(b => b.textContent?.trim()===label);
  if (!button && label === "Nahrát jiný soubor") {
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Možnosti výpisu"]')!.click());
    button = [...host.querySelectorAll("button")].find(b => b.textContent?.trim()===label);
  }
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}
describe("bank import completion",() => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
    (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
    result={ status:"committed",remaining:0,errors:[] };mocks.confirm.mockResolvedValue(true);
    mocks.fetch.mockImplementation(async (url: string,options?: { method?:string }) => {
      if(url.endsWith("/commit"))return { ...result,imported:1,matched:0,revision:3 };
      if(options?.method==="PATCH")return { revision:2 };
      if(url==="/api/payments/imports")return options?.method==="POST" ? preview : { imports:[] };
      if(url.startsWith("/api/payments/invoice-candidates"))return { invoices:[],total:0 };
      return detail;
    });
    host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root.render(<GpcImportPanel invoices={[]} canManage onCommitted={committed}/>));
  });
  afterEach(async () => { await act(async () => root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals(); });
  it("opens the review workspace without the upload hero and restores it when changing the file", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    await act(async () => root.render(<PaymentsClient initialData={{ payments: [], open_invoices: [], can_manage: true, gpc_enabled: true, runtime_mode: "production-database" }} />));
    expect(host.querySelector(".payments-hero")).not.toBeNull();
    await uploadFiles();
    expect(host.querySelector(".payments-hero")).toBeNull();
    expect(host.querySelector(".gpc-preview")).not.toBeNull();
    expect(host.querySelector("#gpc-statement-title")?.textContent).toBe("test.gpc");
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
    await click("Nahrát jiný soubor");
    expect(host.querySelector(".payments-hero")).not.toBeNull();
    expect(host.querySelector(".gpc-preview")).toBeNull();
  });
  it("returns to an empty upload screen only after successful completion",async () => {
    await uploadFiles();await click("Zaúčtovat výpis");
    expect(host.querySelector('input[type="file"]')).not.toBeNull();
    expect(host.querySelector(".gpc-preview")).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Import proběhl úspěšně.");
    expect(committed).toHaveBeenCalledOnce();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel:"Zaúčtovat",confirmVariant:"primary" }));
    await uploadFiles(["next.gpc"]);
    expect(host.querySelector(".gpc-preview")).not.toBeNull();
    expect(host.textContent).not.toContain("Import proběhl úspěšně.");
  });
  it("retains review when some rows still need processing",async () => {
    result={ status:"review",remaining:1,errors:[] };
    await uploadFiles();await click("Zaúčtovat výpis");
    expect(host.querySelector(".gpc-preview")).not.toBeNull();
    expect(host.textContent).not.toContain("Import proběhl úspěšně.");
  });
  it("does not hide row errors behind a success notice",async () => {
    result={ status:"review",remaining:1,errors:[{ line_number:1,code:"possible_duplicate" }] };
    await uploadFiles();await click("Zaúčtovat výpis");
    expect(host.querySelector(".gpc-preview")).not.toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Řádek 1");
  });
  it("preserves remaining files in a multi-file queue",async () => {
    await uploadFiles(["first.gpc","second.gpc"]);await click("Zaúčtovat výpis");
    expect(host.querySelector('input[type="file"]')).not.toBeNull();
    await click("Pokračovat dalším výpisem (2 z 2)");
    expect(host.querySelector(".gpc-file-summary-copy")?.textContent).toContain("second.gpc");
  });
  function holdUpload() {
    let resolve!: (value: typeof preview) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<typeof preview>((yes, no) => { resolve = yes; reject = no; });
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url: string, options?: { method?: string }) =>
      url === "/api/payments/imports" && options?.method === "POST" ? pending : original(url, options));
    return { resolve, reject };
  }
  it("shows real save and booking stages only after confirmation", async () => {
    await uploadFiles();
    let finishSave!: (value: { revision: number }) => void;
    let finishBooking!: (value: object) => void;
    const saving = new Promise(resolve => { finishSave = resolve; });
    const booking = new Promise(resolve => { finishBooking = resolve; });
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url: string, options?: { method?: string }) =>
      url.endsWith("/commit") ? booking : options?.method === "PATCH" ? saving : original(url, options));
    await click("Zaúčtovat výpis");
    expect(host.querySelector('[data-statement-processing] [aria-current="step"]')?.textContent).toContain("Uložení přiřazení");
    expect(host.querySelector(".gpc-preview")).toBeNull();
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/commit"))).toHaveLength(0);
    await act(async () => finishSave({ revision: 2 }));
    expect(host.querySelector('[data-statement-processing] [aria-current="step"]')?.textContent).toContain("Zaúčtování plateb");
    expect(host.querySelector('[role="progressbar"]')?.hasAttribute("aria-valuenow")).toBe(false);
    await act(async () => finishBooking({ ...result, imported: 1, matched: 0, revision: 3 }));
    expect(host.querySelector("[data-statement-processing]")).toBeNull();
    expect(host.textContent).toContain("Import proběhl úspěšně.");
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/commit"))).toHaveLength(1);
  });
  it("returns to the review with an error when booking fails", async () => {
    await uploadFiles();
    let rejectBooking!: (error: Error) => void;
    const booking = new Promise((_, reject) => { rejectBooking = reject; });
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url: string, options?: { method?: string }) =>
      url.endsWith("/commit") ? booking : original(url, options));
    await click("Zaúčtovat výpis");
    expect(host.querySelector("[data-statement-processing]")).not.toBeNull();
    await act(async () => rejectBooking(new Error("Zaúčtování se nepodařilo dokončit.")));
    expect(host.querySelector("[data-statement-processing]")).toBeNull();
    expect(host.querySelector(".gpc-preview")).not.toBeNull();
    expect(host.textContent).toContain("Zaúčtování se nepodařilo dokončit.");
    expect(committed).not.toHaveBeenCalled();
  });
  it("does not start booking or its loader after cancelling confirmation", async () => {
    await uploadFiles();
    mocks.confirm.mockResolvedValue(false);
    await click("Zaúčtovat výpis");
    expect(host.querySelector("[data-statement-processing]")).toBeNull();
    expect(host.querySelector(".gpc-preview")).not.toBeNull();
    expect(mocks.fetch.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
  });
  it("shows the shared OCR-style loader until the statement response arrives", async () => {
    const pending = holdUpload();
    await uploadFiles();
    const loading = host.querySelector("[data-statement-processing]");
    expect(loading).not.toBeNull();
    expect(loading?.querySelector('[role="progressbar"]')?.hasAttribute("aria-valuenow")).toBe(false);
    expect(loading?.querySelector('[aria-current="step"]')?.textContent).toContain("Načítání a párování plateb");
    expect(loading?.textContent).toContain("Výpis 1 z 1");
    expect(loading?.textContent).not.toContain("OCR");
    expect(host.querySelector('input[type="file"]')).toBeNull();
    expect(host.querySelector(".gpc-preview")).toBeNull();
    await act(async () => pending.resolve(preview));
    expect(host.querySelector("[data-statement-processing]")).toBeNull();
    expect(host.querySelector(".gpc-preview")).not.toBeNull();
  });
  it("restores file selection and displays an error after a failed upload", async () => {
    const pending = holdUpload();
    await uploadFiles();
    await act(async () => pending.reject(new Error("Soubor není platný bankovní výpis.")));
    expect(host.querySelector("[data-statement-processing]")).toBeNull();
    expect(host.querySelector('input[type="file"]')).not.toBeNull();
    expect(host.querySelector(".form-error")?.textContent).toContain("Soubor není platný bankovní výpis.");
    expect(committed).not.toHaveBeenCalled();
  });
  it("shows the actual position when processing the next queued statement", async () => {
    await uploadFiles(["first.gpc", "second.gpc"]);
    await click("Zaúčtovat výpis");
    const pending = holdUpload();
    await click("Pokračovat dalším výpisem (2 z 2)");
    expect(host.querySelector("[data-statement-processing]")?.textContent).toContain("Výpis 2 z 2");
    await act(async () => pending.resolve(preview));
    expect(host.querySelector("#gpc-statement-title")?.textContent).toBe("second.gpc");
  });
});
