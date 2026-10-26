// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice, Preview, PreviewDetail, PreviewEntry } from "./payment-matching-types";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiFetch: mocks.fetch, ApiRequestError: class extends Error {} }));
vi.mock("@/lib/confirm-action", () => ({ confirmAction: mocks.confirm }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
import { GpcImportPanel } from "./gpc-import-panel";

const invoice = (id: string, amount = 100): Invoice => ({ id, invoice_number: id, variable_symbol: id, counterparty_name: `Firma ${id}`, counterparty_ico: "12345678", amount, paid_amount: 0, currency: "CZK", due_date: "2026-10-04" });
const row = (id: number, overrides: Partial<PreviewEntry> = {}): PreviewEntry & { id: string } => ({ id: `entry-${id}`, line_number: id, fingerprint: `row-${id}`, disposition: "accepted", reason: null, amount: 100, currency: "CZK", booked_on: "2026-10-03", variable_symbol: `VS-${id}`, counterparty_name: `Plátce ${id}`, counterparty_account: "123456789/0100", counterparty_account_verified: true, proposal_kind: "exact", proposal_confidence: "safe", proposal_reason: "VS a částka odpovídají.", proposed_invoice_ids: [`invoice-${id}`], ...overrides });
let host: HTMLDivElement, root: Root, preview: Preview, detail: PreviewDetail, candidates: Invoice[];
const committed = vi.fn();
function buttons(text: string, scope: ParentNode = host) { return [...scope.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.textContent?.trim() === text); }
async function click(text: string, scope: ParentNode = host) { const button = buttons(text, scope)[0]; expect(button).toBeDefined(); await act(async () => button.click()); }
async function action(label: string) { const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; expect(button).not.toBeNull(); await act(async () => button.click()); }
async function inputText(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function upload() {
  const input = host.querySelector('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["fixture"], "výpis.gpc")], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
function scoped(id: number) { return host.querySelector<HTMLElement>(`[data-payment-row="row-${id}"]`)!; }
function mutations() { return mocks.fetch.mock.calls.filter(([, options]) => ["POST", "PATCH"].includes(options?.method)).filter(([url]) => url !== "/api/payments/imports"); }

beforeEach(async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  mocks.fetch.mockReset(); mocks.confirm.mockReset().mockResolvedValue(true); committed.mockReset();
  candidates = [invoice("invoice-1"), invoice("invoice-2"), invoice("invoice-3"), invoice("invoice-4"), invoice("split-a", 40), invoice("split-b", 60)];
  const entries = [row(1), row(2), row(3, { proposed_invoice_ids: [], proposal_kind: "manual", proposal_confidence: "review", counterparty_name: null }), row(4, { proposed_invoice_ids: ["invoice-1", "invoice-2"], proposal_kind: "ambiguous", proposal_confidence: "review" })];
  preview = { import: { id: "statement", revision: 1, duplicate: false, status: "review" }, account_mismatch: false, statement_account: "123/0100", expected_account: "123/0100", totals: { accepted: 4, ignored: 0, errors: 0 }, entries, proposal_invoices: candidates, total_entries: 4, request_id: "fixture" };
  detail = { ...preview, entries, progress: { booked: 0, errors: 0, remaining: 4 }, match_reasons: {}, allocations: entries.slice(0,2).map(entry => ({ statement_entry_id: entry.id, invoice_id: entry.proposed_invoice_ids[0], amount: 100, is_manual_partial: false, is_committed: false })), total: 4 };
  mocks.fetch.mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
    if (url === "/api/payments/imports") return options?.method === "POST" ? preview : { imports: [] };
    if (url.startsWith("/api/payments/invoice-candidates")) return { invoices: candidates, total: candidates.length };
    if (url.endsWith("/commit")) return { status: "review", revision: 3, remaining: 1, imported: 1, matched: 1, errors: [] };
    if (url.endsWith("/release")) return {};
    if (url.endsWith("/overlap")) return { revision: 2 };
    if (options?.method === "PATCH") return { revision: 2 };
    return detail;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<GpcImportPanel invoices={candidates} canManage onCommitted={committed}/>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("payment matching review and existing transports", () => {
  it("renders a safe proposal and leaves ambiguous and unknown rows unselected", async () => {
    await upload();
    expect(scoped(1).textContent).toContain("Firma invoice-1");
    expect(scoped(1).textContent).toContain("Vysoká shoda");
    expect(scoped(3).textContent).toContain("Neznámý plátce");
    expect(buttons("Potvrdit", scoped(3))[0].disabled).toBe(true);
    expect(scoped(4).querySelector('button[aria-label="Vybrat fakturu · řádek 4"]')).not.toBeNull();
    expect(buttons("Potvrdit", scoped(4))[0].disabled).toBe(true);
    expect(mutations()).toEqual([]);
  });
  it("saves only the confirmed row and never invokes statement commit", async () => {
    await upload(); await click("Potvrdit", scoped(1));
    expect(mutations()).toHaveLength(1);
    const [url, options] = mutations()[0];
    expect(url).toBe("/api/payments/imports/statement"); expect(options.method).toBe("PATCH");
    expect(JSON.parse(options.body)).toMatchObject({ reviewed_entry_ids: ["entry-1"], allocations: [{ entry_id: "entry-1", invoice_id: "invoice-1", amount: 100 }] });
    expect(scoped(1).textContent).toContain("Přiřazení uloženo");
    expect(committed).not.toHaveBeenCalled();
  });
  it("selects eligible rows, exposes indeterminate and saves exactly the selected set", async () => {
    await upload();
    await act(async () => scoped(1).querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Vybrat vše na aktuální stránce"]')?.indeterminate).toBe(true);
    await click("Potvrdit vybrané");
    expect(JSON.parse(mutations()[0][1].body).reviewed_entry_ids).toEqual(["entry-1"]);
    expect(mutations().some(([url]) => url.endsWith("/commit"))).toBe(false);
  });
  it("manual selection closes the picker and enables row confirmation", async () => {
    await upload(); await action("Vybrat fakturu · řádek 3");
    const dialog = host.querySelector<HTMLDivElement>("[data-invoice-dropdown]")!;
    const option = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("VS invoice-3"))!;
    await act(async () => option.click());
    expect(host.querySelector("[data-invoice-dropdown]")).toBeNull();
    expect(buttons("Potvrdit", scoped(3))[0].disabled).toBe(false);
    await click("Potvrdit", scoped(3));
    expect(JSON.parse(mutations()[0][1].body).allocations[0].invoice_id).toBe("invoice-3");
  });
  it("removes an assignment without booking and lets the user select the invoice again", async () => {
    await upload();
    await action("Vybrat fakturu · řádek 1");
    await click("Odstranit přiřazení", host.querySelector("[data-invoice-dropdown]")!);
    expect(scoped(1).textContent).not.toContain("Firma invoice-1");
    expect(scoped(1).querySelector('button[aria-label="Nespárováno"]')).not.toBeNull();
    expect(JSON.parse(mutations()[0][1].body)).toMatchObject({ reviewed_entry_ids: ["entry-1"], unrelated_entry_ids: [], allocations: [] });
    expect(mutations().some(([url]) => url.endsWith("/commit"))).toBe(false);
    await action("Vybrat fakturu · řádek 1");
    const option = [...host.querySelectorAll<HTMLButtonElement>("[data-invoice-dropdown] button")].find(button => button.textContent?.includes("VS invoice-1"))!;
    await act(async () => option.click());
    expect(buttons("Potvrdit", scoped(1))[0].disabled).toBe(false);
    await click("Potvrdit", scoped(1));
    expect(JSON.parse(mutations()[1][1].body).allocations[0]).toMatchObject({ invoice_id: "invoice-1", amount: 100 });
  });
  it("keeps the assignment when removing it fails", async () => {
    await upload();
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url: string, options?: { method?: string }) => options?.method === "PATCH" ? Promise.reject(new Error("Odstranění se nepodařilo.")) : original(url, options));
    await action("Akce platby · řádek 1");
    await click("Odstranit přiřazení");
    expect(scoped(1).textContent).toContain("Firma invoice-1");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Odstranění se nepodařilo.");
  });
  it("uses the existing organization-scoped candidate search", async () => {
    await upload(); await action("Vybrat fakturu · řádek 3");
    await inputText(host.querySelector<HTMLInputElement>('input[aria-label="Hledat fakturu"]')!, "Firma 12345678");
    await act(async () => new Promise(resolve => setTimeout(resolve, 280)));
    expect(mocks.fetch.mock.calls.some(([url]) => url.includes("invoice-candidates?q=Firma%2012345678&page=1"))).toBe(true);
  });
  it("opens a nonmodal dropdown and closes it with the trigger, Escape or an outside click", async () => {
    await upload();
    await action("Vybrat fakturu · řádek 3");
    expect(host.querySelector("dialog[open]")).toBeNull();
    expect(host.querySelector('[data-invoice-dropdown] [aria-label="Hledat fakturu"]')).toBe(document.activeElement);
    await action("Vybrat fakturu · řádek 3");
    expect(host.querySelector("[data-invoice-dropdown]")).toBeNull();
    await action("Vybrat fakturu · řádek 3");
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector("[data-invoice-dropdown]")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Vybrat fakturu · řádek 3");
    await action("Vybrat fakturu · řádek 3");
    await act(async () => host.querySelector("h1")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(host.querySelector("[data-invoice-dropdown]")).toBeNull();
  });
  it("keeps split allocations and validates their total", async () => {
    await upload(); await action("Akce platby · řádek 3"); await click("Rozdělit platbu");
    let dialog = host.querySelector<HTMLDivElement>("[data-invoice-dropdown]")!;
    for (const id of ["split-a", "split-b"]) {
      const option = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes(`VS ${id}`))!;
      await act(async () => option.click());
    }
    dialog = host.querySelector("[data-invoice-dropdown]")!;
    await click("Hotovo", dialog);
    expect(buttons("Potvrdit", scoped(3))[0].disabled).toBe(false);
    await click("Potvrdit", scoped(3));
    const allocations = JSON.parse(mutations()[0][1].body).allocations;
    expect(allocations.map((a: { amount: number }) => a.amount)).toEqual([40, 60]);
  });
  it("requires the explicit partial-payment choice", async () => {
    candidates[0].amount = 120; detail.allocations[0].amount = 120;
    await upload(); expect(buttons("Potvrdit", scoped(1))[0].disabled).toBe(true);
    await action("Vybrat fakturu · řádek 1");
    await act(async () => host.querySelector<HTMLInputElement>('[data-invoice-dropdown] input[type="checkbox"]')!.click());
    await click("Hotovo", host.querySelector("[data-invoice-dropdown]")!); await click("Potvrdit", scoped(1));
    expect(JSON.parse(mutations()[0][1].body).allocations[0]).toMatchObject({ amount: 100, is_manual_partial: true });
  });
  it("preserves unrelated and own-transfer decisions with no invoice allocation", async () => {
    detail.own_transfers = { "entry-3": "Protiúčet je vlastní účet organizace." };
    await upload(); expect(scoped(3).textContent).toContain("Vlastní převod");
    await click("Potvrdit", scoped(3));
    expect(JSON.parse(mutations()[0][1].body)).toMatchObject({ unrelated_entry_ids: ["entry-3"], allocations: [] });
    await action("Akce platby · řádek 3"); await click("Vrátit mezi platby");
    expect(scoped(3).textContent).not.toContain("Přiřazení uloženo");
    expect(buttons("Potvrdit", scoped(3))[0].disabled).toBe(true);
  });
  it("blocks confirmation until the statement account is checked", async () => {
    preview.account_mismatch = true; preview.expected_account = "999/0300";
    await upload(); expect(buttons("Potvrdit", scoped(1))[0].disabled).toBe(true);
    expect(buttons("Zaúčtovat výpis")[0].disabled).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>('details input[type="checkbox"]')!.click());
    expect(buttons("Potvrdit", scoped(1))[0].disabled).toBe(false);
    await click("Zaúčtovat výpis");
    const committedRequest = mutations().find(([url]) => url.endsWith("/commit"));
    expect(JSON.parse(committedRequest![1].body).acknowledge_account_mismatch).toBe(true);
  });
  it("preserves duplicate/ignored/error/booked rows without making them confirmable", async () => {
    preview.import.duplicate = true;
    const otherRows = [row(5, { disposition: "ignored", reason: "Odchozí platba" }), row(6, { disposition: "duplicate" }), row(7, { disposition: "error", processing_error: "possible_duplicate" }), row(8, { bank_payment_id: "payment", proposal_reason: null })];
    const allRows = [...detail.entries, ...otherRows]; preview.entries = allRows; detail.entries = allRows;
    await upload(); expect(host.textContent).toContain("Tento výpis už byl dříve nahraný");
    for (const id of [5,6,7,8]) expect(buttons("Potvrdit", scoped(id))).toHaveLength(0);
    await action("Akce platby · řádek 8"); await click("Uvolnit platbu a změnit přiřazení");
    expect(mutations().some(([url]) => url.endsWith("/release"))).toBe(true);
  });
  it("reloads unpaid candidates after release and permits assigning the same invoice again", async () => {
    const paidInvoice = { ...invoice("invoice-1"), paid_amount: 100 };
    candidates = candidates.filter(candidate => candidate.id !== paidInvoice.id);
    detail.proposal_invoices = [paidInvoice, ...candidates];
    preview.proposal_invoices = detail.proposal_invoices;
    detail.entries[0].bank_payment_id = "booked-payment";
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url: string, options?: { method?: string }) => {
      if (url.endsWith("/release")) {
        detail.entries[0] = { ...detail.entries[0], bank_payment_id: null, proposal_kind: "manual", proposed_invoice_ids: [] };
        detail.allocations = detail.allocations.filter(allocation => allocation.statement_entry_id !== "entry-1");
        // Detail may omit the old invoice now that its allocation was removed.
        detail.proposal_invoices = candidates;
        candidates = [invoice("invoice-1"), ...candidates];
      }
      return original(url, options);
    });
    await upload();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    const candidateRequests = () => mocks.fetch.mock.calls.filter(([url]) => url.startsWith("/api/payments/invoice-candidates"));
    const beforeRelease = candidateRequests().length;
    await action("Akce platby · řádek 1");
    await click("Uvolnit platbu a změnit přiřazení");
    await action("Vybrat fakturu · řádek 1");
    expect(host.textContent).toContain("Načítáme faktury");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(candidateRequests().length).toBeGreaterThan(beforeRelease);
    const dialog = host.querySelector('[data-invoice-dropdown]')!;
    const restoredInvoice = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes("VS invoice-1"))!;
    expect(restoredInvoice).toBeDefined();
    expect(restoredInvoice.disabled).toBe(false);
    await act(async () => restoredInvoice.click());
    expect(buttons("Potvrdit", scoped(1))[0].disabled).toBe(false);
    await click("Potvrdit", scoped(1));
    const saved = mutations().find(([, options]) => options?.method === "PATCH");
    expect(JSON.parse(saved![1].body).allocations).toEqual(expect.arrayContaining([expect.objectContaining({ invoice_id: "invoice-1", amount: 100 })]));
    expect(mutations().filter(([url]) => url.endsWith("/commit"))).toHaveLength(0);
  });
  it("filters and searches without modifying payment decisions", async () => {
    await upload();
    await action("Filtry plateb");
    await click("Nespárováno1");
    await click("Zobrazit výsledky");
    expect(host.querySelectorAll("[data-payment-row]")).toHaveLength(1);
    await inputText(host.querySelector<HTMLInputElement>('input[aria-label="Hledat platby na aktuální stránce"]')!, "neexistuje");
    expect(host.querySelectorAll("[data-payment-row]")).toHaveLength(0);
    expect(mutations()).toEqual([]);
  });
  it("retains the current choices and exposes an error if saving fails", async () => {
    await upload(); const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url: string, options?: { method?: string }) => options?.method === "PATCH" ? Promise.reject(new Error("Návrh mezitím změnil jiný uživatel.")) : original(url, options));
    await click("Potvrdit", scoped(1));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("jiný uživatel");
    expect(scoped(1).textContent).toContain("Firma invoice-1"); expect(buttons("Potvrdit", scoped(1))[0].disabled).toBe(false);
    expect(committed).not.toHaveBeenCalled();
  });
  it("does not dispatch a second save on rapid repeat clicks", async () => {
    await upload(); let finish!: (value: { revision: number }) => void;
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url: string, options?: { method?: string }) => options?.method === "PATCH" ? new Promise(resolve => { finish = resolve; }) : original(url, options));
    const button = buttons("Potvrdit", scoped(1))[0];
    await act(async () => { button.click(); button.click(); });
    expect(mutations()).toHaveLength(1);
    await act(async () => finish({ revision: 2 }));
  });
  it("does not allow mutations when permission is removed", async () => {
    await upload(); await act(async () => root.render(<GpcImportPanel invoices={candidates} canManage={false} onCommitted={committed}/>));
    expect(buttons("Potvrdit", scoped(1))[0].disabled).toBe(true); expect(buttons("Zaúčtovat výpis")[0].disabled).toBe(true);
    await action("Akce platby · řádek 1");
    expect(buttons("Nesouvisí s fakturami")).toHaveLength(0); expect(mutations()).toEqual([]);
  });
  it("keeps the explicit overlapping-transaction check before confirming a row", async () => {
    preview.entries[0].overlap_warning = true;
    await upload(); expect(buttons("Potvrdit", scoped(1))[0].disabled).toBe(true);
    await action("Akce platby · řádek 1"); await click("Ověřeno: jde o další platbu");
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Ano, je to další platba" }));
    expect(mutations().some(([url]) => url.endsWith("/overlap"))).toBe(true);
    expect(buttons("Potvrdit", scoped(1))[0].disabled).toBe(false);
    await click("Potvrdit", scoped(1));
    expect(mutations().filter(([, options]) => options.method === "PATCH")).toHaveLength(1);
  });
  it("shows candidate search failure and allows retry without losing selected invoices", async () => {
    await upload(); const original = mocks.fetch.getMockImplementation()!;
    let fail = true;
    mocks.fetch.mockImplementation((url: string, options?: { method?: string }) => url.startsWith("/api/payments/invoice-candidates") && fail ? Promise.reject(new Error("Vyhledávání není dostupné.")) : original(url, options));
    await action("Vybrat fakturu · řádek 1");
    await inputText(host.querySelector<HTMLInputElement>('input[aria-label="Hledat fakturu"]')!, "test");
    await act(async () => new Promise(resolve => setTimeout(resolve, 280)));
    expect(host.querySelector('[data-invoice-dropdown] [role="alert"]')?.textContent).toContain("Vyhledávání není dostupné");
    fail = false; await click("Zkusit znovu");
    await act(async () => new Promise(resolve => setTimeout(resolve, 280)));
    expect(host.querySelector('[data-invoice-dropdown] [role="alert"]')).toBeNull();
    await click("Hotovo", host.querySelector("[data-invoice-dropdown]")!);
    expect(scoped(1).textContent).toContain("Firma invoice-1");
  });
});
