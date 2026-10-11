import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain, fakeRequest } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), from: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/operator-server", () => ({ getOperatorSession: mocks.session }));
vi.mock("resend", () => ({ Resend: class { emails = { send: mocks.send }; } }));
import { DELETE, POST } from "./route";

const ORG = "22222222-2222-4222-8222-222222222222";
const post = (body: unknown) => POST(fakeRequest("http://localhost/api/operator/support", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RESEND_API_KEY", "re_test");
  mocks.from.mockReturnValue(fakeChain({ data: { name: "Nová firma s.r.o." }, error: null, count: 2 } as never));
  mocks.rpc.mockResolvedValue({ data: { session_id: "s1", expires_at: "2026-10-10T15:00:00Z", admin_emails: ["jednatel@novafirma.cz"] }, error: null });
  mocks.send.mockResolvedValue({ data: { id: "e1" }, error: null });
  mocks.session.mockResolvedValue({ user: { id: "op-1" }, email: "podpora@splatno.cz", service: { from: mocks.from, rpc: mocks.rpc } });
});

describe("support provozovatele", () => {
  it("is refused to anyone who is not an operator with 2FA", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await post({ organization_id: ORG, reason: "Kontrola výpisu", minutes: 60 })).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a reason and an allowed duration", async () => {
    expect((await post({ organization_id: ORG, reason: "x", minutes: 60 })).status).toBe(400);
    expect((await post({ organization_id: ORG, reason: "Kontrola výpisu", minutes: 999 })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("starts the session in the database and notifies the company's admins", async () => {
    const response = await post({ organization_id: ORG, reason: "Kontrola výpisu", minutes: 60 });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("start_support_session", expect.objectContaining({ target_org: ORG, operator_user: "op-1", minutes: 60 }));
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: ["jednatel@novafirma.cz"], replyTo: "podpora@splatno.cz" }), expect.anything());
    expect((await response.json()).notified).toBe(1);
  });

  it("ends the operator's session", async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    const response = await DELETE(fakeRequest("http://localhost/api/operator/support", { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("end_support_session", { operator_user: "op-1", ended_by_user: "op-1" });
  });
});
