// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch:vi.fn(),confirm:vi.fn(),role:"admin" }));
vi.mock("@/lib/api-client",() => ({ apiFetch:mocks.fetch,ApiRequestError:class extends Error {} }));
vi.mock("@/lib/confirm-action",() => ({ confirmAction:mocks.confirm }));
vi.mock("@/lib/use-access-role",() => ({ useAccessRole:() => mocks.role }));
import { GpcImportPanel } from "./gpc-import-panel";
const invoice = { id:"inv-a",invoice_number:"2026001",counterparty_name:"Novák s.r.o.",amount:100,paid_amount:0,currency:"CZK",variable_symbol:"2026001" };
const invoiceB = { id:"inv-b",invoice_number:"2026002",counterparty_name:"Dvořák s.r.o.",amount:150,paid_amount:0,currency:"CZK",variable_symbol:"2026002" };
const entry = { id:"entry",line_number:1,fingerprint:"fingerprint",disposition:"accepted",reason:null,amount:100,currency:"CZK",booked_on:"2026-10-03",variable_symbol:null as string | null,counterparty_name:"Customer",counterparty_account:null,counterparty_account_verified:false,proposal_kind:"manual",proposal_confidence:"review",proposal_reason:null as string | null,proposed_invoice_ids:[] as string[] };
let preview: Record<string,unknown>;
let detail: Record<string,unknown>;
function setEntries(entries: Array<typeof entry>, extra: Record<string,unknown> = {}) {
  preview = { import:{ id:"statement",revision:1,duplicate:false,status:"review" },account_mismatch:false,statement_account:null,expected_account:null,totals:{ accepted:entries.length,ignored:0,errors:0 },entries,proposal_invoices:[invoice,invoiceB],total_entries:entries.length,request_id:"test",...extra };
  detail = { ...preview,progress:{ booked:0,errors:0,remaining:entries.length },match_reasons:{},allocations:[],total:entries.length };
}
let host: HTMLDivElement,root: Root;
let result: { status:string;remaining:number;errors:Array<{ line_number:number;code:string }> };
const committed = vi.fn();
const requests = () => mocks.fetch.mock.calls.map(([url,options]) => ({ url:String(url),method:options?.method ?? "GET",body:typeof options?.body==="string" ? JSON.parse(options.body) : null }));
async function uploadFiles(names = ["test.gpc"]) {
  const input = host.querySelector('input[type="file"]')!;
  Object.defineProperty(input,"files",{ configurable:true,value:names.map(name => new File(["test"],name)) });
  await act(async () => { input.dispatchEvent(new Event("change",{ bubbles:true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve,0)); });
}
function button(label: string) {
  return [...host.querySelectorAll("button")].find(b => b.textContent?.trim()===label);
}
async function click(label: string) {
  const target = button(label);
  expect(target,`button „${label}“`).toBeDefined();
  await act(async () => { target!.click(); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve,0)); });
}
describe("bank import completion",() => {
  beforeEach(async () => {
    vi.resetAllMocks(); (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
    mocks.role="admin";
    setEntries([entry]);
    result={ status:"committed",remaining:0,errors:[] };mocks.confirm.mockResolvedValue(true);
    mocks.fetch.mockImplementation(async (url: string,options?: { method?:string }) => {
      if(url.endsWith("/commit"))return { ...result,imported:1,matched:0,revision:3 };
      if(options?.method==="PATCH")return { revision:2 };
      if(url==="/api/payments/imports")return options?.method==="POST" ? preview : { imports:[] };
      if(url.startsWith("/api/payments/invoice-candidates"))return { invoices:[invoice,invoiceB],total:2 };
      if(url==="/api/settings/bank-accounts")return { account:{ id:"x" } };
      return detail;
    });
    host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root.render(<GpcImportPanel invoices={[]} canManage onCommitted={committed}/>));
  });
  afterEach(async () => { await act(async () => root.unmount());host.remove(); });
  it("returns to an empty upload screen only after successful completion",async () => {
    await uploadFiles();await click("Zaúčtovat");
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
    await uploadFiles();await click("Zaúčtovat");
    expect(host.querySelector(".gpc-preview")).not.toBeNull();
    expect(host.textContent).not.toContain("Import proběhl úspěšně.");
  });
  it("does not hide row errors behind a success notice",async () => {
    result={ status:"review",remaining:1,errors:[{ line_number:1,code:"possible_duplicate" }] };
    await uploadFiles();await click("Zaúčtovat");
    expect(host.querySelector(".gpc-preview")).not.toBeNull();
    expect(host.querySelector(".form-error")?.textContent).toContain("Řádek 1 (Customer)");
  });
  it("preserves remaining files in a multi-file queue",async () => {
    await uploadFiles(["first.gpc","second.gpc"]);await click("Zaúčtovat");
    expect(host.querySelector('input[type="file"]')).not.toBeNull();
    await click("Pokračovat dalším výpisem (2 z 2)");
    expect(host.querySelector(".gpc-file-summary-copy")?.textContent).toContain("second.gpc");
  });
});

describe("kontrola plateb pro člověka, který se v účetnictví nevyzná",() => {
  beforeEach(async () => {
    vi.resetAllMocks(); (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
    mocks.role="admin";
    result={ status:"committed",remaining:0,errors:[] };mocks.confirm.mockResolvedValue(true);
    mocks.fetch.mockImplementation(async (url: string,options?: { method?:string }) => {
      if(url.endsWith("/commit"))return { ...result,imported:1,matched:1,revision:3 };
      if(options?.method==="PATCH")return { revision:2 };
      if(url==="/api/payments/imports")return options?.method==="POST" ? preview : { imports:[] };
      if(url.startsWith("/api/payments/invoice-candidates"))return { invoices:[invoice,invoiceB],total:2 };
      if(url==="/api/settings/bank-accounts")return { account:{ id:"x" } };
      if(url.endsWith("/discard"))return { discarded:true };
      return detail;
    });
    host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root.render(<GpcImportPanel invoices={[]} canManage onCommitted={committed}/>));
  });
  afterEach(async () => { await act(async () => root.unmount());host.remove(); });

  it("přijme návrh jedním tlačítkem a lišta i dialog řeknou rozsah česky",async () => {
    setEntries([{ ...entry,proposal_kind:"exact",proposal_reason:"Stejný plátce, jiný VS",proposed_invoice_ids:["inv-a"] }]);
    await uploadFiles();
    expect(host.textContent).toContain("Stejný plátce, jiný variabilní symbol.");
    expect(host.textContent).toContain("Zbývá odpovědět: 1");
    await click("Ano, je to tato faktura");
    expect(host.textContent).toContain("Zbývá odpovědět: 0");
    await click("Zaúčtovat 1 platbu");
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title:"Zaúčtovat 1 platbu k 1 faktuře?",confirmLabel:"Zaúčtovat" }));
    const patch = requests().find(request => request.method==="PATCH");
    expect(patch?.body.allocations).toEqual([{ entry_id:"entry",invoice_id:"inv-a",amount:100,is_manual_partial:false }]);
  });

  it("bez návrhu rovnou nabídne výběr faktury předvyplněný podle plátce",async () => {
    setEntries([{ ...entry,counterparty_name:"Novák s.r.o." }]);
    await uploadFiles();
    for (let tick = 0; tick < 3; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve,5)); });
    expect(host.textContent).toContain("Nenašli jsme fakturu");
    expect(host.querySelector<HTMLInputElement>(".invoice-picker input[type=search]")?.value).toBe("Novák s.r.o.");
    expect(requests().some(request => request.url.startsWith("/api/payments/invoice-candidates?q=Nov%C3%A1k%20s.r.o."))).toBe(true);
    const option = [...host.querySelectorAll<HTMLLabelElement>(".invoice-option")].find(label => label.textContent?.includes("2026001"))!;
    expect(option.textContent).toContain("sedí částka");
    await act(async () => { option.querySelector("input")!.click(); });
    expect(host.querySelector(".invoice-picker-balance")?.textContent).toContain("✓");
    expect(host.textContent).toContain("Zbývá odpovědět: 0");
    await click("Hotovo");
    expect(host.querySelector(".invoice-picker")).toBeNull();
    expect(host.textContent).toContain("Připraveno k zaúčtování.");
  });

  it("menší platbu se zeptá na částečnou úhradu a uloží ji jako nižší částku",async () => {
    setEntries([{ ...entry,amount:60,proposal_kind:"exact",proposed_invoice_ids:["inv-a"] }]);
    await uploadFiles();
    await click("Ano, je to tato faktura");
    expect(host.textContent).toContain("Zaplatil odběratel jen část?");
    await click("Ano, je to částečná úhrada");
    expect(host.textContent).toContain("Částečná úhrada – faktura zůstane zčásti neuhrazená.");
    await click("Zaúčtovat 1 platbu");
    const patch = requests().find(request => request.method==="PATCH");
    expect(patch?.body.allocations).toEqual([{ entry_id:"entry",invoice_id:"inv-a",amount:60,is_manual_partial:false }]);
  });

  it("„Nesouvisí s fakturami“ pošle řádek mezi nesouvisející a jde vrátit",async () => {
    setEntries([{ ...entry,proposal_kind:"exact",proposed_invoice_ids:["inv-a"] }]);
    await uploadFiles();
    await click("Nesouvisí s fakturami");
    expect(button("Vrátit mezi platby")).toBeDefined();
    await click("Zaúčtovat");
    const patch = requests().find(request => request.method==="PATCH");
    expect(patch?.body.unrelated_entry_ids).toEqual(["entry"]);
    expect(patch?.body.allocations).toEqual([]);
  });

  it("neshoda účtu je otázka; „přidat k účtům firmy“ uloží účet a odemkne zaúčtování",async () => {
    setEntries([entry],{ account_mismatch:true,statement_account:"19-2000145399/0800",expected_account:"6786420257/0100" });
    await uploadFiles();
    expect(host.textContent).toContain("Je účet 19-2000145399/0800 váš?");
    expect(button("Zaúčtovat")?.disabled).toBe(true);
    await click("Ano, přidat k účtům firmy");
    expect(requests().find(request => request.url==="/api/settings/bank-accounts")?.body).toMatchObject({ account:"19-2000145399/0800",currency:"CZK" });
    expect(button("Zaúčtovat")?.disabled).toBe(false);
    await click("Zaúčtovat");
    expect(requests().find(request => request.url.endsWith("/commit"))?.body.acknowledge_account_mismatch).toBe(true);
  });

  it("účetní (ne admin) může potvrdit jen tentokrát; omyl zahodí výpis s potvrzením",async () => {
    mocks.role="accounting";
    setEntries([entry],{ account_mismatch:true,statement_account:"19-2000145399/0800" });
    await uploadFiles();
    expect(button("Ano, přidat k účtům firmy")).toBeUndefined();
    await click("Ne, je to omyl");
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title:"Zahodit tento výpis?" }));
    expect(requests().some(request => request.url.endsWith("/discard"))).toBe(true);
    expect(host.querySelector(".gpc-preview")).toBeNull();
  });
});
