import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ denied: 0, scopes: ["invoices:read","invoices:write","invoices:send","payments:write"], data: null as unknown, error: null as unknown, filters: [] as [string, unknown][], issued: vi.fn(), sent: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/structured-log", () => ({ logError: vi.fn(), requestId: () => "public-test" }));
vi.mock("@/lib/auth-api-key", () => {
  class ApiKeyError extends Error { constructor(message: string, readonly status: number, readonly code: string) { super(message); } }
  const query = () => {
    const q = { select: () => q, eq: (k: string, v: unknown) => { state.filters.push([k,v]); return q; }, order: () => q, limit: () => q, or: () => q, maybeSingle: async () => ({data:state.data,error:state.error}), single: async () => ({data:state.data,error:state.error}), then: (resolve: (v:unknown)=>unknown) => Promise.resolve({data:state.data,error:state.error}).then(resolve) }; return q;
  };
  return { ApiKeyError, recordApiKeyRequest: state.audit, getApiKeyIdentity: async (_r: Request, scope: string) => {
    if (state.denied) throw new ApiKeyError("Odmítnuto",state.denied,"invalid_api_key");
    if (!state.scopes.includes(scope)) throw new ApiKeyError("Scope",403,"insufficient_scope");
    return { organizationId:"11111111-1111-4111-8111-111111111111", actingUserId:"actor", keyId:"key", scopes:state.scopes, service:{from:query,rpc:async (_name:string,args:Record<string,unknown>)=>{state.filters.push(["organization_id",args.target_org]);if(args.target_invoice)state.filters.push(["invoice_id",args.target_invoice]);return {data:state.data,error:state.error};}}, membership:{organization_id:"11111111-1111-4111-8111-111111111111",role:"admin"}, user:{id:"actor"} };
  } };
});
vi.mock("@/lib/invoice-issue-server", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/invoice-issue-server")>();
  return {...actual, issueCreation:state.issued};
});
vi.mock("@/lib/invoice-send-server", () => ({sendInvoiceEmail:state.sent}));
vi.mock("@/lib/invoice-pdf", () => ({generateInvoicePdf:async()=>new Uint8Array([37,80,68,70]),invoicePdfFilename:()=>"invoice.pdf",invoicePdfResponse:(bytes:Uint8Array)=>new Response(bytes,{headers:{"content-type":"application/pdf"}})}));
import { GET as listInvoices, POST as createInvoice } from "./invoices/route";
import { GET as getInvoice } from "./invoices/[id]/route";
import { GET as pdfInvoice } from "./invoices/[id]/pdf/route";
import { POST as sendInvoice } from "./invoices/[id]/send/route";
import { GET as listEvents } from "./events/route";
import { GET as listPayments } from "./payments/route";
import { GET as listReminders } from "./reminders/route";
import { InvoiceIssueError } from "@/lib/invoice-issue-server";
const id="22222222-2222-4222-8222-222222222222";
const context=()=>({params:Promise.resolve({id})});
const invoice=()=>({id,invoice_number:"FV-2026-000001",amount:18400,amount_without_vat:16428.57,paid_amount:0,currency:"CZK",status:"pending",issue_date:"2026-11-14",due_date:"2026-11-21",counterparty_name:"Test",counterparty_email:"test@example.com",money_evidence:null});
const body=()=>({issue_date:"2026-11-14",due_date:"2026-11-21",customer:{name:"Test",address:"Test 1"},items:[{description:"Dřevo",quantity:1,unit:"ks",unit_price_gross:"18400",vat_rate:12}],expected_total:18400});
const request=(payload:unknown,key="order-1")=>new Request("https://example.com/api/v1/invoices",{method:"POST",headers:{"content-type":"application/json","idempotency-key":key},body:JSON.stringify(payload)});
beforeEach(()=>{state.denied=0;state.scopes=["invoices:read","invoices:write","invoices:send","payments:write"];state.data=null;state.error=null;state.filters=[];state.issued.mockReset().mockResolvedValue({invoice:invoice(),replayed:false});state.sent.mockReset().mockResolvedValue(Response.json({ok:true}));state.audit.mockReset().mockResolvedValue(undefined);});
describe("public invoice routes",()=>{
  it("authenticates before parsing or creating and keeps a stable error contract",async()=>{
    state.denied=401;const response=await createInvoice(request({}));
    expect(response.status).toBe(401);expect(state.issued).not.toHaveBeenCalled();expect(await response.json()).toMatchObject({code:"invalid_api_key",request_id:"public-test"});
  });
  it("creates with a tenant-namespaced operation ID and full money options",async()=>{
    const response=await createInvoice(request(body()));expect(response.status).toBe(201);
    expect(state.issued.mock.calls[0][1]).toMatchObject({items:[{price_mode:"gross",unit_price:"18400"}]});
    expect(state.issued.mock.calls[0][2]).toMatchObject({autoNumber:true,defaultPaymentAccount:true,expectedTotal:18400,paidAmount:0});
    expect((await response.json()).invoice.amount).toBe("18400.00");
  });
  it("does not treat a replay as another creation",async()=>{
    state.issued.mockResolvedValue({invoice:invoice(),replayed:true});const response=await createInvoice(request(body()));
    expect(response.status).toBe(200);expect((await response.json()).replayed).toBe(true);
  });
  it.each([[402,"monthly_invoice_limit"],[409,"idempotency_conflict"],[422,"total_mismatch"]])("preserves domain error %s",async(status,code)=>{
    state.issued.mockRejectedValue(new InvoiceIssueError("Odmítnuto",status,code,{computed:18000}));
    const response=await createInvoice(request(body()));expect(response.status).toBe(status);expect(await response.json()).toMatchObject({code,computed:18000});
  });
  it("requires extra permission for initial paid state",async()=>{
    state.scopes=["invoices:write"];
    const response=await createInvoice(request({...body(),paid_amount:18400,payment_confirmed:true}));
    expect(response.status).toBe(403);expect(state.issued).not.toHaveBeenCalled();
  });
  it("does not report stale monetary state when post-insert refresh fails",async()=>{
    state.issued.mockResolvedValue({invoice:invoice(),replayed:false,refresh_required:true});
    const response=await createInvoice(request({...body(),paid_amount:18400,payment_confirmed:true}));
    expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"invoice_refresh_required",invoice_id:id});
  });
  it("requires a retry key and forbids client-selected organization",async()=>{
    expect((await createInvoice(request({...body(),organization_id:"other"}))).status).toBe(400);
    expect((await createInvoice(request(body(),""))).status).toBe(400);expect(state.issued).not.toHaveBeenCalled();
  });
  it("scopes lookup to the key's company and hides inaccessible invoices",async()=>{
    const response=await getInvoice(new Request("https://example.com"),context());
    expect(response.status).toBe(404);expect(state.filters).toContainEqual(["organization_id","11111111-1111-4111-8111-111111111111"]);expect(state.filters).toContainEqual(["id",id]);
  });
  it("returns a bounded list without private accounting metadata",async()=>{
    state.data=[{...invoice(),created_at:"2026-11-14T12:00:00.000Z",notes:"private",organization_id:"private"}];
    const response=await listInvoices(new Request("https://example.com/api/v1/invoices?limit=1"));
    const result=await response.json();expect(result.data).toHaveLength(1);expect(result.data[0]).not.toHaveProperty("organization_id");expect(result.data[0]).not.toHaveProperty("notes");
  });
  it("returns scoped PDF bytes with private cache headers",async()=>{
    state.data=invoice();const response=await pdfInvoice(new Request("https://example.com"),context());
    expect(response.headers.get("content-type")).toBe("application/pdf");expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.filters.filter(([k])=>k==="organization_id")).toHaveLength(1);expect(state.filters).toContainEqual(["id","11111111-1111-4111-8111-111111111111"]);
  });
  it("requires recipient confirmation, uses shared sender and keeps retry stable",async()=>{
    const response=await sendInvoice(request({recipient_confirmed:true}),context());expect(response.status).toBe(200);
    const forwarded=state.sent.mock.calls[0][0] as Request;expect(forwarded.headers.get("x-idempotency-key")).toMatch(/^[\da-f-]{36}$/);expect(await forwarded.json()).toEqual({purpose:"issue",recipient_confirmed:true});
    state.sent.mockClear();expect((await sendInvoice(request({}),context())).status).toBe(400);expect(state.sent).not.toHaveBeenCalled();
  });
});

describe("public operational feeds",()=>{
  it.each([["events:read",listEvents],["payments:read",listPayments],["reminders:read",listReminders]] as const)("requires %s and scopes every read to the company",async(scope,handler)=>{
    state.scopes=[];expect((await handler(new Request("https://example.com/api/v1/feed"))).status).toBe(403);
    state.scopes=[scope];state.data=[];
    const response=await handler(new Request(`https://example.com/api/v1/feed?limit=10&invoice_id=${id}`));
    expect(response.status).toBe(200);expect(state.filters).toContainEqual(["organization_id","11111111-1111-4111-8111-111111111111"]);expect(state.filters).toContainEqual(["invoice_id",id]);
    expect(await response.json()).toMatchObject({data:[],has_more:false});
  });
  it("includes committed split allocations and precise balances in the payment projection",async()=>{
    state.scopes=["payments:read"];
    state.data=[{id,amount:300,currency:"CZK",created_at:"2026-11-14T12:00:00.000Z",invoice_id:null,allocations:[{invoice_id:id,amount:100},{invoice_id:"33333333-3333-4333-8333-333333333333",amount:200}],allocated_amount:300,unallocated_amount:0,allocation_status:"allocated"}];
    const response=await listPayments(new Request(`https://example.com/api/v1/payments?invoice_id=${id}`));
    expect(response.status).toBe(200);
    const result=await response.json();
    expect(result.data[0]).toMatchObject({amount:"300.00",allocated_amount:"300.00",unallocated_amount:"0.00",allocations:[{invoice_id:id,amount:"100.00"},{amount:"200.00"}]});
  });
  it("keeps an event cursor after the last page and excludes internal details",async()=>{
    state.scopes=["events:read"];state.data=[{id,invoice_id:id,event_type:"paid",created_at:"2026-11-14T12:00:00.000Z",details:{private:"sensitive"}}];
    const response=await listEvents(new Request("https://example.com/api/v1/events"));
    const result=await response.json();expect(result.data[0]).toEqual({id,type:"invoice.paid",invoice_id:id,created_at:"2026-11-14T12:00:00.000Z"});expect(result.next_cursor).toBeTruthy();
  });
});
