import "server-only";

import { createHmac } from "node:crypto";
import { createServiceClient } from "@/lib/supabase-server";
import { resolveLoginSessionSecret } from "@/lib/login-session";

type AuthAction = "registration_access" | "password_recovery";

const limits: Record<AuthAction, { ip: number; email: number; windowSeconds: number }> = {
  registration_access: { ip: 30, email: 10, windowSeconds: 15 * 60 },
  password_recovery: { ip: 10, email: 3, windowSeconds: 15 * 60 },
};

function secret() {
  const value = resolveLoginSessionSecret(process.env.EMAIL_MFA_SECRET?.trim());
  if (!value) throw new Error("Chybí bezpečný EMAIL_MFA_SECRET.");
  return value;
}

export function authRateLimitSubject(value: string) {
  return createHmac("sha256", secret()).update(`auth-rate-limit:${value}`).digest("hex");
}

export function requestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
}

export async function consumePublicAuthLimit(request: Request, action: AuthAction, normalizedEmail: string) {
  const service = createServiceClient();
  const limit = limits[action];
  const subjects = [
    { suffix: "ip", hash: authRateLimitSubject(`ip:${requestIp(request)}`), max: limit.ip },
    { suffix: "email", hash: authRateLimitSubject(`email:${normalizedEmail}`), max: limit.email },
  ] as const;

  for (const subject of subjects) {
    const { data, error } = await service.rpc("consume_auth_rate_limit", {
      target_action: `${action}_${subject.suffix}`,
      target_subject_hash: subject.hash,
      target_max_attempts: subject.max,
      target_window_seconds: limit.windowSeconds,
    });
    if (error) throw error;
    if (data !== true) return false;
  }
  return true;
}
