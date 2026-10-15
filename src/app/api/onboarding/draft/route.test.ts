import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRequest } from "../../payments/__test-helpers__";
import { normalizeOnboardingCompany } from "@/lib/onboarding";

const mocks = vi.hoisted(() => ({ session: vi.fn(), membership: vi.fn(), from: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedSession: mocks.session, resolveMembership: mocks.membership }));
import { PUT } from "./route";
const draft = { version: 1, step: 4, reached: 4, updatedAt: 100, company: normalizeOnboardingCompany({}), vatPayer: false,
  invites: [], reminders: { days: [7], replyTo: "", ccText: "" }, logo: null };
const call = (body: unknown, origin?: string) => PUT(fakeRequest("http://localhost/api/onboarding/draft", { method: "PUT", body: JSON.stringify(body), origin }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "authenticated-founder" }, service: { from: mocks.from } });
  mocks.membership.mockResolvedValue(null);
  mocks.from.mockReturnValue({ upsert: mocks.upsert });
  mocks.upsert.mockResolvedValue({ error: null });
});
describe("uložení rozpracovaného onboardingu", () => {
  it("requires same origin and a verified MFA session", async () => {
    expect((await call(draft, "https://evil.example")).status).toBe(403);
    mocks.session.mockResolvedValue(null);
    expect((await call(draft)).status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("uses the signed-in user rather than any client-supplied owner", async () => {
    expect((await call({ ...draft, user_id: "someone-else" })).status).toBe(200);
    expect(mocks.upsert.mock.calls[0][0].user_id).toBe("authenticated-founder");
    expect(mocks.upsert.mock.calls[0][0].payload).not.toHaveProperty("user_id");
  });
  it("cannot turn a draft into an active company or jump to payment", async () => {
    expect((await call({ ...draft, step: 8, reached: 8 })).status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
    mocks.membership.mockResolvedValue({ membership: { organization_id: "org" } });
    expect((await call(draft)).status).toBe(409);
  });
  it("bounds requests even without a Content-Length header", async () => {
    expect((await call({ ...draft, ignored: "x".repeat(800_001) })).status).toBe(413);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("reports a database failure instead of pretending the progress is saved", async () => {
    mocks.upsert.mockResolvedValue({ error: { code: "unavailable" } });
    expect((await call(draft)).status).toBe(503);
  });
});
