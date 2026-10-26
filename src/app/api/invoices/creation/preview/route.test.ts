import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ identity: vi.fn(), company: vi.fn(), prepare: vi.fn(), pdf: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity, canManageInvoices: (role: string) => role === "admin" }));
vi.mock("@/lib/invoice-creation-server", () => ({ CREATION_COMPANY_FIELDS: "name", creationSupplier: (value: unknown) => value, prepareCreation: mocks.prepare }));
vi.mock("@/lib/issued-invoice-pdf", () => ({ generateIssuedInvoicePdf: mocks.pdf }));
vi.mock("@/lib/structured-log", () => ({ logError: mocks.log, requestId: () => "preview-request" }));
import { InvoiceCreationError } from "@/lib/invoice-creation";
import { POST } from "./route";
const request = () => new Request("https://example.test/api/invoices/creation/preview", { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ creation: {} }) });
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: () => query, eq: () => query, single: mocks.company };
  mocks.identity.mockResolvedValue({ membership: { organization_id: "own-org", role: "admin" }, service: { from: () => query } });
  mocks.company.mockResolvedValue({ data: { name: "Our supplier" }, error: null });
  mocks.prepare.mockResolvedValue({ document: { invoice_number: "FV-1" } });
  mocks.pdf.mockResolvedValue(new Uint8Array([1,2,3]));
});
it("returns controlled validation messages as a client error", async () => {
  mocks.prepare.mockRejectedValueOnce(new InvoiceCreationError("Doplňte název odběratele."));
  const response = await POST(request());
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: "Doplňte název odběratele." });
  expect(mocks.pdf).not.toHaveBeenCalled();
});
it.each(["prepare", "pdf"] as const)("hides an unknown %s error and includes the request ID in response and log", async stage => {
  mocks[stage].mockRejectedValueOnce(new Error("private database or library diagnostics"));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(response.headers.get("x-request-id")).toBe("preview-request");
  const body = await response.json();
  expect(body).toMatchObject({ code: "invoice_preview_failed", request_id: "preview-request" });
  expect(body.error).not.toContain("private");
  expect(mocks.log).toHaveBeenCalledWith(expect.any(String), expect.any(Error), { request_id: "preview-request" });
});
it("fails closed on a company read error", async () => {
  mocks.company.mockResolvedValueOnce({ data: null, error: { message: "private DB error" } });
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "company_read_failed", request_id: "preview-request" });
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.pdf).not.toHaveBeenCalled();
});
