import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ identity: vi.fn(), rpc: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: state.identity, canManageInvoices: () => true }));
vi.mock("@/lib/billing-server", () => ({ subscriptionBlock: vi.fn(), subscriptionErrorResponse: vi.fn() }));
vi.mock("@/lib/structured-log", () => ({ logError: state.log, requestId: () => "export-test-request" }));
import { GET } from "./route";

const ids = [1, 2, 3].map(value => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`);
const invoices = ids.map((id, index) => ({
  id, invoice_number: `FV-${index + 1}`, counterparty_name: `Klient ${index + 1}`, counterparty_ico: "12345678", counterparty_email: "test@example.invalid",
  amount_without_vat: 100, vat_rate: 21, amount: 121, paid_amount: 21, currency: "CZK", issue_date: "2026-10-01", due_date: "2026-10-21", status: "pending", reminders_sent: 0,
}));
const request = (selection: string, extra = "") => new Request(`http://localhost/api/invoices?format=xlsx&selected_ids=${selection}${extra}`);
beforeEach(() => {
  vi.clearAllMocks();
  state.identity.mockResolvedValue({ user: { id: "authenticated-user" }, membership: { organization_id: "own-organization" }, service: { rpc: state.rpc } });
  state.rpc.mockResolvedValue({ data: { invoices, total: 3 }, error: null });
});

describe("selected invoice Excel export", () => {
  it("exports only the selected rows in selection order using the authorized page", async () => {
    state.rpc.mockResolvedValue({ data: { invoices, total: 200_001 }, error: null });
    const response = await GET(request(`${ids[1]},${ids[0]}`, "&page=2&page_size=25&currency=CZK&status=pending&organization_id=foreign"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("vybrane-faktury.xlsx");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("list_invoices_page_filtered", expect.objectContaining({ target_org: "own-organization", actor_user: "authenticated-user", page_number: 2, page_size: 25, currency_filter: "CZK", status_filter: "pending" }));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    const sheet = workbook.getWorksheet("Faktury")!;
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getCell("A2").value).toBe("FV-2");
    expect(sheet.getCell("A3").value).toBe("FV-1");
    expect(sheet.getCell("G2").value).toBe(121);
    expect(sheet.getCell("L2").value).toBeInstanceOf(Date);
    expect(sheet.getRow(1).font.bold).toBe(true);
  });
  it.each(["", "not-an-id", `${ids[0]},${ids[0]}`, Array.from({ length: 101 }, (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`).join(",")])("rejects malformed selection before loading data", async selection => {
    expect((await GET(request(selection))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    state.identity.mockResolvedValue(null);
    expect((await GET(request(ids[0]))).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects inaccessible or stale IDs instead of exporting a partial selection", async () => {
    const response = await GET(request(`${ids[0]},ffffffff-ffff-ffff-ffff-ffffffffffff`));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Výběr faktur se změnil. Obnovte seznam a vyberte faktury znovu." });
  });
  it("reports RPC failure without returning a workbook or private error", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "private database failure" } });
    const response = await GET(request(ids[0]));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private database failure");
  });
  it("preserves the existing export of all filtered invoices", async () => {
    const response = await GET(new Request("http://localhost/api/invoices?format=xlsx"));
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("list_invoices_page_filtered", expect.objectContaining({ page_number: 1, page_size: 500 }));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.getWorksheet("Faktury")!.rowCount).toBe(4);
  });
});
