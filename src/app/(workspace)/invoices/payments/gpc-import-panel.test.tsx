// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch:vi.fn(),confirm:vi.fn() }));
vi.mock("@/lib/api-client",() => ({ apiFetch:mocks.fetch,ApiRequestError:class extends Error {} }));
vi.mock("@/lib/confirm-action",() => ({ confirmAction:mocks.confirm }));
import { GpcImportPanel } from "./gpc-import-panel";
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
  const button = [...host.querySelectorAll("button")].find(b => b.textContent?.trim()===label);
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}
describe("bank import completion",() => {
  beforeEach(async () => {
    vi.resetAllMocks(); (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
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
  afterEach(async () => { await act(async () => root.unmount());host.remove(); });
  it("returns to an empty upload screen only after successful completion",async () => {
    await uploadFiles();await click("Uložit kontrolu a potvrdit import");
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
    await uploadFiles();await click("Uložit kontrolu a potvrdit import");
    expect(host.querySelector(".gpc-preview")).not.toBeNull();
    expect(host.textContent).not.toContain("Import proběhl úspěšně.");
  });
  it("does not hide row errors behind a success notice",async () => {
    result={ status:"review",remaining:1,errors:[{ line_number:1,code:"possible_duplicate" }] };
    await uploadFiles();await click("Uložit kontrolu a potvrdit import");
    expect(host.querySelector(".gpc-preview")).not.toBeNull();
    expect(host.querySelector(".form-error")?.textContent).toContain("Řádek 1");
  });
  it("preserves remaining files in a multi-file queue",async () => {
    await uploadFiles(["first.gpc","second.gpc"]);await click("Uložit kontrolu a potvrdit import");
    expect(host.querySelector('input[type="file"]')).not.toBeNull();
    await click("Pokračovat dalším výpisem (2 z 2)");
    expect(host.querySelector(".gpc-file-summary-copy")?.textContent).toContain("second.gpc");
  });
});
