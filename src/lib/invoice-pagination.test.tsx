// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvoicesPage from "@/app/(workspace)/invoices/page";
import { loadInvoiceListPageData } from "./invoice-list-page-data";
import { INVOICE_PAGE_SIZE_COOKIE, saveInvoicePageSize } from "./invoice-page-size";
import { signOutCurrentSession } from "./sign-out";
const state = vi.hoisted(() => ({ rpc: vi.fn(), cookie: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
vi.mock("@/lib/auth", () => ({ getCachedRequestIdentity: async () => ({ membership: { organization_id:"org", role:"admin" }, user:{id:"user"}, service:{rpc:state.rpc} }) }));
vi.mock("@/app/(workspace)/invoices/invoices-client", () => ({ InvoicesClient: () => null }));
vi.mock("@/lib/company-settings-draft", () => ({ clearCompanySettingsDrafts: vi.fn() }));
vi.mock("@/lib/use-access-role", () => ({ resetAccessProfileCache: vi.fn() }));
beforeEach(() => {
  state.cookie=undefined;
  state.rpc.mockReset().mockResolvedValue({ data:{ invoices:[], total:126, open_totals:{CZK:1000}, currencies:["CZK"], active_count:100 },error:null });
});
afterEach(() => { document.cookie=`${INVOICE_PAGE_SIZE_COOKIE}=; Max-Age=0; Path=/`; vi.unstubAllGlobals(); });
describe("persistent invoice pagination", () => {
  it("uses saved preference on the server before rendering", async () => {
    state.cookie="50";
    const page=await InvoicesPage({searchParams:Promise.resolve({page:"2",status:"pending"})});
    expect(state.rpc).toHaveBeenCalledWith("list_invoices_page_filtered",expect.objectContaining({page_size:50,page_number:2,status_filter:"pending",target_org:"org",actor_user:"user"}));
    expect(page.props.initialData).toMatchObject({page_size:50,total_pages:3,page:2});
    expect(page.props.initialKey).toContain("page_size=50");
  });
  it("explicit URL size takes priority without dropping filters", async () => {
    state.cookie="100";
    const page=await InvoicesPage({searchParams:Promise.resolve({page_size:"10",q:"WOOD",currency:"CZK"})});
    expect(page.props.initialData).toMatchObject({page_size:10,total_pages:13});
    expect(state.rpc).toHaveBeenCalledWith("list_invoices_page_filtered",expect.objectContaining({page_size:10,search_query:"WOOD",currency_filter:"CZK"}));
  });
  it("ignores an invalid stored preference", async () => {
    state.cookie="999999";
    const page=await InvoicesPage({searchParams:Promise.resolve({})});
    expect(page.props.initialData.page_size).toBe(25);
  });
  it("retains the browser preference when the user signs out", async () => {
    saveInvoicePageSize(100);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{}',{status:200})));
    await signOutCurrentSession();
    expect(document.cookie).toContain(`${INVOICE_PAGE_SIZE_COOKIE}=100`);
  });
  it("still requires identity before querying any invoices", async () => {
    await expect(loadInvoiceListPageData(null,{query:"",status:null,currency:null,from:null,to:null,dueFrom:null,dueTo:null,amountMin:null,amountMax:null,paymentState:null,bankMatch:null,page:1,pageSize:100})).rejects.toThrow("Nejste přihlášený");
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
