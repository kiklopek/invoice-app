import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain, fakeRequest } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ limit: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/auth-rate-limit", () => ({ consumePublicAuthLimit: mocks.limit }));
vi.mock("@/lib/supabase-server", () => ({ createServiceClient: () => ({ from: mocks.from }) }));
import { POST } from "./route";

const call = (body: unknown) => POST(fakeRequest("http://localhost/api/auth/registration-access", { method: "POST", body: JSON.stringify(body) }));
const rows = (data: unknown[]) => mocks.from.mockReturnValue(fakeChain({ data, error: null }));
const hlavicaInvite = { id: "m1", user_id: null, organizations: { allowed_email_domain: "hlavica.cz" } };
const otherInvite = { id: "m2", user_id: null, organizations: { allowed_email_domain: null } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockResolvedValue(true);
  rows([]);
});

describe("obecná registrace (splatno.cz/register)", () => {
  it("lets a new company founder register", async () => {
    expect(await (await call({ email: "jan@novafirma.cz" })).json()).toEqual({ allowed: true, kind: "founder" });
  });

  it("joins an invited person to their (non-Hlavica) company", async () => {
    rows([otherInvite]);
    expect(await (await call({ email: "ucetni@novafirma.cz" })).json()).toEqual({ allowed: true, kind: "invited" });
  });

  it("sends every @hlavica.cz address to the R. Hlavica registration", async () => {
    expect(await (await call({ email: "novy@hlavica.cz" })).json()).toEqual({ allowed: false, kind: "hlavica" });
    rows([hlavicaInvite]);
    expect(await (await call({ email: "pozvany@hlavica.cz" })).json()).toEqual({ allowed: false, kind: "hlavica" });
  });
});

describe("registrace R. Hlavica (splatno.cz/hlavica/registrace)", () => {
  it("works exactly as before: only an invited @hlavica.cz address", async () => {
    rows([hlavicaInvite]);
    expect(await (await call({ email: "pozvany@hlavica.cz", entry: "hlavica" })).json()).toEqual({ allowed: true, kind: "invited" });
  });

  it("refuses an @hlavica.cz address nobody invited", async () => {
    expect((await (await call({ email: "nepozvany@hlavica.cz", entry: "hlavica" })).json()).allowed).toBe(false);
  });

  it("refuses any other domain, even with an invitation elsewhere", async () => {
    rows([otherInvite]);
    expect((await (await call({ email: "ucetni@novafirma.cz", entry: "hlavica" })).json()).allowed).toBe(false);
  });

  it("tells an existing member to sign in instead", async () => {
    rows([{ ...hlavicaInvite, user_id: "u1" }]);
    expect(await (await call({ email: "clen@hlavica.cz", entry: "hlavica" })).json()).toEqual({ allowed: false, kind: "member" });
  });
});
