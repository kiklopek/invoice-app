import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  load: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity }));
vi.mock("@/lib/report-page-data", () => ({ loadReportPageData: mocks.load }));
vi.mock("@/lib/dashboard-page-data", () => ({
  PageDataError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));
import { GET } from "./route";
import ExcelJS from "exceljs";
const request = (query = "") =>
  new Request(
    `http://localhost/api/reports?from=2026-10-01&to=2026-10-23&currency=CZK${query}`,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({
    user: { id: "actor-a" },
    membership: { organization_id: "org-a", role: "admin" },
    service: { rpc: mocks.rpc },
  });
  mocks.load.mockResolvedValue({ invoice_count: 0, total: 0 });
});
describe("reports authorization and unchanged export scope", () => {
  it("requires authentication for JSON and XLSX", async () => {
    mocks.identity.mockResolvedValue(null);
    for (const query of ["", "&format=xlsx"])
      expect((await GET(request(query))).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects an unauthorized role before querying reports or export", async () => {
    mocks.identity.mockResolvedValue({ membership: { role: null } });
    for (const query of ["", "&format=xlsx"])
      expect((await GET(request(query))).status).toBe(403);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("derives tenant and actor from identity even if another company is requested", async () => {
    await GET(
      request("&organization_id=org-b&target_org=org-b&actor_user=actor-b"),
    );
    expect(mocks.load.mock.calls[0][0].membership.organization_id).toBe(
      "org-a",
    );
    mocks.rpc.mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
    mocks.rpc.mockResolvedValueOnce({
      data: { rows: [], total: 20001 },
      error: null,
    });
    expect((await GET(request("&format=xlsx&target_org=org-b"))).status).toBe(
      413,
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "invoice_report_rows_page",
      expect.objectContaining({
        target_org: "org-a",
        actor_user: "actor-a",
        currency_filter: "CZK",
      }),
    );
  });
  it("honors existing viewer permission; there is no separate export-denied viewer role", async () => {
    mocks.identity.mockResolvedValue({
      user: { id: "viewer" },
      membership: { role: "viewer", organization_id: "org-a" },
      service: { rpc: mocks.rpc },
    });
    expect((await GET(request())).status).toBe(200);
    mocks.rpc.mockResolvedValue({
      data: { rows: [], total: 20001 },
      error: null,
    });
    expect((await GET(request("&format=xlsx"))).status).toBe(413);
    expect(mocks.rpc).toHaveBeenCalled();
  });
  it("passes every supported filter, validates dates and never caches private JSON", async () => {
    const result = await GET(
      request("&date_basis=due_date&status=cancelled&customer=Test"),
    );
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.load.mock.calls[0][1]).toMatchObject({
      dateBasis: "due_date",
      status: "cancelled",
      customer: "Test",
      currency: "CZK",
    });
    expect(
      (
        await GET(
          new Request(
            "http://localhost/api/reports?from=invalid&to=2026-10-01",
          ),
        )
      ).status,
    ).toBe(400);
  });
  it("exports filtered invoice cents, paid balances and VAT/aging using the existing sheets", async () => {
    mocks.rpc.mockImplementation((name: string) =>
      Promise.resolve({
        error: null,
        data:
          name === "invoice_report_rows_page"
            ? {
                total: 1,
                rows: [
                  {
                    id: "one",
                    invoice_number: "FV-1",
                    counterparty_name: "Test",
                    amount_without_vat: 1000.41,
                    vat_rate: 21,
                    amount: 1210.5,
                    paid_amount: 300,
                    remaining_amount: 910.5,
                    currency: "EUR",
                    issue_date: "2026-10-01",
                    due_date: "2026-10-23",
                    paid_at: null,
                    status: "pending",
                    reminders_sent: 0,
                  },
                ],
              }
            : {
                vat_breakdown: [
                  {
                    vat_rate: 21,
                    base: 1000.41,
                    tax: 210.09,
                    gross: 1210.5,
                    count: 1,
                  },
                ],
                aging: [{ label: "Před splatností", amount: 910.5, count: 1 }],
              },
      }),
    );
    const result = await GET(
      new Request(
        "http://localhost/api/reports?from=2026-10-01&to=2026-10-23&currency=EUR&customer=Test&format=xlsx",
      ),
    );
    expect(result.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await result.arrayBuffer());
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Report faktur",
      "DPH přehled",
      "Aging pohledávek",
    ]);
    expect(workbook.worksheets[0].getCell("E2").value).toBe(1210.5);
    expect(workbook.worksheets[0].getCell("G2").value).toBe(910.5);
    expect(workbook.worksheets[1].getCell("C2").value).toBe(210.09);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "invoice_report_rows_page",
      expect.objectContaining({
        target_org: "org-a",
        currency_filter: "EUR",
        customer_filter: "Test",
      }),
    );
  });
});
