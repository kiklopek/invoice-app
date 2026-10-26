import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
const state=vi.hoisted(()=>({identity:null as unknown,auth:vi.fn(),totals:vi.fn(),log:vi.fn()}));
vi.mock("@/lib/auth",()=>({getRequestIdentity:state.auth}));
vi.mock("@/lib/invoice-list-totals",()=>({loadInvoiceListTotals:state.totals}));
vi.mock("@/lib/structured-log",()=>({logError:state.log,requestId:()=>"totals-request"}));
beforeEach(()=>{vi.clearAllMocks();state.identity={membership:{organization_id:"org-a"},user:{id:"user-a"}};state.auth.mockResolvedValue(state.identity);state.totals.mockResolvedValue({CZK:123.45,EUR:50});});
describe("invoice totals read endpoint",()=>{
  it("rejects unauthenticated requests without loading totals",async()=>{
    state.auth.mockResolvedValue(null);const response=await GET(new Request('http://localhost/api/invoices/totals'));
    expect(response.status).toBe(401);expect(state.totals).not.toHaveBeenCalled();
  });
  it("validates filters before loading financial data",async()=>{
    const response=await GET(new Request('http://localhost/api/invoices/totals?status=anything'));
    expect(response.status).toBe(400);expect(state.totals).not.toHaveBeenCalled();
  });
  it("uses the authenticated identity, preserves filters, and prevents shared caching",async()=>{
    const response=await GET(new Request('http://localhost/api/invoices/totals?status=paid&currency=CZK&organization_id=other'));
    expect(response.status).toBe(200);expect(await response.json()).toEqual({CZK:123.45,EUR:50});expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(state.totals).toHaveBeenCalledWith(state.identity,expect.objectContaining({status:'paid',currency:'CZK'}));
  });
  it("logs failures and returns a traceable error without internal details",async()=>{
    state.totals.mockRejectedValue(new Error('private database details'));const response=await GET(new Request('http://localhost/api/invoices/totals'));
    expect(response.status).toBe(500);expect(await response.json()).toMatchObject({request_id:'totals-request',code:'invoice_totals_failed'});expect(state.log).toHaveBeenCalledOnce();
  });
});
