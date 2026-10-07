import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain, fakeIdentity, fakeRequest } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), rpc: vi.fn(), from: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity }));
vi.mock("@/lib/invitation-server", () => ({ sendInvitation: mocks.send }));
import { POST } from "./route";

const add = () => POST(fakeRequest("http://localhost/api/settings/members", {
  method: "POST", body: JSON.stringify({ email: "novy@firma.cz", role: "accounting" }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue(fakeIdentity({ service: { rpc: mocks.rpc, from: mocks.from } }));
  mocks.rpc.mockResolvedValue({ data: { member: { id: "m1", email: "novy@firma.cz", role: "accounting", user_id: null, created_at: "2026-10-07" } }, error: null });
  mocks.send.mockResolvedValue({ sent: true, expiresAt: "2026-10-14T00:00:00Z" });
});

describe("přidání člena", () => {
  it("sends the e-mail invitation for an ordinary company", async () => {
    mocks.from.mockReturnValue(fakeChain({ data: { allowed_email_domain: null }, error: null }));
    const response = await add();
    expect(response.status).toBe(201);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect((await response.json()).invitation.sent).toBe(true);
  });

  // R. Hlavica funguje jako dosud: přístup se přidá a člověk se sám
  // zaregistruje na splatno.cz/hlavica/registrace. Žádný e-mail navíc.
  it("keeps R. Hlavica as before: access only, no e-mail", async () => {
    mocks.from.mockReturnValue(fakeChain({ data: { allowed_email_domain: "hlavica.cz" }, error: null }));
    const response = await add();
    expect(response.status).toBe(201);
    expect(mocks.send).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.invitation).toEqual({ sent: false, reason: "registration", registrationPath: "/hlavica/registrace" });
  });
});
