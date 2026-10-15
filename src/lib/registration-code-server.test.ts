import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain } from "@/app/api/payments/__test-helpers__";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), get: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.get, set: mocks.set }) }));
vi.mock("@/lib/supabase-server", () => ({ createServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/email-mfa-server", () => ({ requireEmailMfaSecret: () => "test-secret-at-least-thirty-two-characters" }));
import { finishRegistrationCode, openRegistrationChallenge, prepareRegistrationCode, REGISTRATION_CODE_COOKIE, saveRegistrationChallenge, sealRegistrationChallenge } from "./registration-code-server";
const secret = "test-secret-at-least-thirty-two-characters";
const challenge = {
  challengeId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333", email: "jana@example.org",
  nativeTokenHash: "a".repeat(64), expiresAt: Date.now() + 600_000,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockReturnValue(fakeChain({ data: null, error: null }));
});

describe("registration code proof", () => {
  it("encrypts the native proof and rejects tampering, a different key and expired cookies", () => {
    const token = sealRegistrationChallenge(challenge, secret);
    expect(token).not.toContain(challenge.nativeTokenHash);
    expect(token).not.toContain(challenge.email);
    expect(openRegistrationChallenge(token, secret)).toEqual(challenge);
    expect(openRegistrationChallenge(token, secret + "wrong")).toBeNull();
    expect(openRegistrationChallenge((token[0] === "A" ? "B" : "A") + token.slice(1), secret)).toBeNull();
    expect(openRegistrationChallenge(token, secret, challenge.expiresAt + 1)).toBeNull();
  });
  it("never releases the native proof for a different email", async () => {
    mocks.get.mockReturnValue({ value: sealRegistrationChallenge(challenge, secret) });
    expect(await finishRegistrationCode("other@example.org", "A7K9B")).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["invalid", "locked", "expired", "not_found"])("does not release proof when the atomic verifier returns %s", async status => {
    mocks.get.mockReturnValue({ value: sealRegistrationChallenge(challenge, secret) });
    mocks.rpc.mockResolvedValue({ data: status, error: null });
    expect(await finishRegistrationCode(challenge.email, "A7K9B")).toBeNull();
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("consumes the cookie after the database verifies the code; replay cannot reach the verifier", async () => {
    let value: string | undefined = sealRegistrationChallenge(challenge, secret);
    mocks.get.mockImplementation(() => value ? { value } : undefined);
    mocks.set.mockImplementation(() => { value = undefined; });
    mocks.rpc.mockResolvedValue({ data: "verified", error: null });
    expect(await finishRegistrationCode(challenge.email, "A7K9B")).toEqual(challenge);
    expect(mocks.rpc.mock.calls[0][1].candidate_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await finishRegistrationCode(challenge.email, "A7K9B")).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("creates a domain-separated hashed challenge and stores only an encrypted HttpOnly proof", async () => {
    mocks.rpc.mockResolvedValue({ data: "created", error: null });
    const prepared = await prepareRegistrationCode({ userId: challenge.userId, email: challenge.email, nativeTokenHash: challenge.nativeTokenHash });
    expect(prepared).not.toBeNull();
    expect(mocks.rpc.mock.calls[0][1].target_code_hash).not.toContain(prepared!.code);
    expect(mocks.rpc.mock.calls[0][1].target_session).not.toBe(challenge.userId);
    await saveRegistrationChallenge(prepared!.challenge);
    expect(mocks.set).toHaveBeenCalledWith(REGISTRATION_CODE_COOKIE, expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: "strict", maxAge: 600 }));
  });
  it("fails closed when the challenge cannot be stored", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("unavailable") });
    await expect(prepareRegistrationCode({ userId: challenge.userId, email: challenge.email, nativeTokenHash: challenge.nativeTokenHash })).rejects.toThrow("REGISTRATION_CHALLENGE_CREATE_FAILED");
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
