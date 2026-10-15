import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { EMAIL_MFA_CODE_TTL_SECONDS, hashEmailMfaCode } from "@/lib/email-mfa-core";
import { requireEmailMfaSecret } from "@/lib/email-mfa-server";
import { createServiceClient } from "@/lib/supabase-server";
import { generateVerificationCode } from "@/lib/verification-code-server";

export const REGISTRATION_CODE_COOKIE = "splatno-registration-code";
const DOMAIN = "splatno.signup-code.v1";
type RegistrationChallenge = {
  challengeId: string; userId: string; sessionId: string; email: string;
  nativeTokenHash: string; expiresAt: number;
};

function encryptionKey(secret: string) {
  return createHash("sha256").update(`${DOMAIN}:${secret}`).digest();
}

export function sealRegistrationChallenge(challenge: RegistrationChallenge, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(DOMAIN));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(challenge), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function openRegistrationChallenge(token: string | undefined, secret: string, now = Date.now()): RegistrationChallenge | null {
  if (!token || token.length > 4096) return null;
  try {
    const [iv, tag, ciphertext, extra] = token.split(".");
    if (!iv || !tag || !ciphertext || extra) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(DOMAIN));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8")) as RegistrationChallenge;
    if (![data.challengeId, data.userId, data.sessionId, data.email, data.nativeTokenHash].every(value => typeof value === "string" && value.length > 0)
      || typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt) || data.expiresAt <= now) return null;
    return data;
  } catch {
    return null;
  }
}

export async function prepareRegistrationCode(input: { userId: string; email: string; nativeTokenHash: string }) {
  const secret = requireEmailMfaSecret();
  const previous = openRegistrationChallenge((await cookies()).get(REGISTRATION_CODE_COOKIE)?.value, secret);
  const challenge: RegistrationChallenge = {
    ...input,
    challengeId: randomUUID(),
    // Registration has no Auth session yet. This separate random namespace
    // cannot be used as proof for a logged-in session's MFA challenge.
    sessionId: previous?.userId === input.userId && previous.email === input.email ? previous.sessionId : randomUUID(),
    expiresAt: Date.now() + EMAIL_MFA_CODE_TTL_SECONDS * 1000,
  };
  const code = generateVerificationCode();
  const service = createServiceClient();
  const { data, error } = await service.rpc("create_email_mfa_challenge", {
    target_challenge: challenge.challengeId, target_user: challenge.userId,
    target_session: challenge.sessionId,
    target_code_hash: hashEmailMfaCode({ challengeId: challenge.challengeId, userId: challenge.userId, sessionId: challenge.sessionId, code, secret: `${DOMAIN}:${secret}` }),
    target_expires_at: new Date(challenge.expiresAt).toISOString(),
  });
  if (error) throw new Error("REGISTRATION_CHALLENGE_CREATE_FAILED");
  if (data === "rate_limited") return null;
  if (data !== "created") throw new Error("REGISTRATION_CHALLENGE_CREATE_FAILED");
  return { challenge, code };
}

export async function registrationCodeRetryAfter(email: string) {
  const challenge = openRegistrationChallenge((await cookies()).get(REGISTRATION_CODE_COOKIE)?.value, requireEmailMfaSecret());
  if (!challenge || challenge.email !== email) return 0;
  const { data, error } = await createServiceClient().from("email_mfa_challenges")
    .select("created_at").eq("user_id", challenge.userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("REGISTRATION_CHALLENGE_LOOKUP_FAILED");
  return data ? Math.max(0, Math.ceil((new Date(data.created_at).getTime() + 60_000 - Date.now()) / 1000)) : 0;
}

export async function saveRegistrationChallenge(challenge: RegistrationChallenge) {
  (await cookies()).set(REGISTRATION_CODE_COOKIE, sealRegistrationChallenge(challenge, requireEmailMfaSecret()), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/",
    maxAge: EMAIL_MFA_CODE_TTL_SECONDS,
  });
}

export async function discardRegistrationChallenge(challenge: RegistrationChallenge) {
  const { error } = await createServiceClient().from("email_mfa_challenges")
    .update({ consumed_at: new Date().toISOString() }).eq("id", challenge.challengeId).eq("user_id", challenge.userId);
  if (error) throw new Error("REGISTRATION_CHALLENGE_CLEANUP_FAILED");
}

export async function finishRegistrationCode(email: string, code: string) {
  const secret = requireEmailMfaSecret();
  const cookieStore = await cookies();
  const challenge = openRegistrationChallenge(cookieStore.get(REGISTRATION_CODE_COOKIE)?.value, secret);
  if (!challenge || challenge.email !== email) return null;
  const { data, error } = await createServiceClient().rpc("verify_email_mfa_challenge", {
    target_challenge: challenge.challengeId, target_user: challenge.userId, target_session: challenge.sessionId,
    candidate_hash: hashEmailMfaCode({ challengeId: challenge.challengeId, userId: challenge.userId, sessionId: challenge.sessionId, code, secret: `${DOMAIN}:${secret}` }),
  });
  if (error) throw new Error("REGISTRATION_CHALLENGE_VERIFY_FAILED");
  if (data !== "verified") return null;
  cookieStore.set(REGISTRATION_CODE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return challenge;
}
