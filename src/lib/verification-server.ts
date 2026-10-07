import "server-only";

import { randomInt } from "node:crypto";
import type { RequestIdentity } from "@/lib/auth";
import { findCompanyDataBox, sendDataBoxMessage, verificationCodeHash } from "@/lib/isds";
import { requireEmailMfaSecret } from "@/lib/email-mfa-server";

export const VERIFICATION_TTL_HOURS = 72;

export type VerificationStart =
  | { status: "sent"; dataBoxId: string; expiresAt: string; mismatch: boolean }
  | { status: "already_verified" }
  | { status: "manual" }
  | { status: "no_data_box" }
  | { status: "unavailable" };

// Ověření firmy datovou schránkou: schránka se dohledá podle IČO v ISDS
// (ne podle toho, co uživatel napsal), takže kód dostane jen ten, kdo má
// přístup do schránky firmy s tímto IČO.
export async function startDataBoxVerification(identity: RequestIdentity): Promise<VerificationStart> {
  const org = identity.membership.organization_id;
  const { data: company, error } = await identity.service
    .from("organizations")
    .select("name, ico, data_box_id, verified_at")
    .eq("id", org)
    .single();
  if (error || !company?.ico) return { status: "unavailable" };
  if (company.verified_at) return { status: "already_verified" };

  const lookup = await findCompanyDataBox(company.ico);
  if (lookup.status === "not_configured") return { status: "manual" };
  if (lookup.status === "not_found") return { status: "no_data_box" };
  if (lookup.status === "unavailable") return { status: "unavailable" };

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_HOURS * 3600_000);
  const sent = await sendDataBoxMessage({
    dataBoxId: lookup.dataBoxId,
    subject: "Ověřovací kód Splatno",
    text: [
      `Dobrý den,`,
      ``,
      `ve službě Splatno (splatno.cz) někdo zakládá účet firmy ${company.name} (IČO ${company.ico}).`,
      `Pokud jste to vy, zadejte v aplikaci tento ověřovací kód: ${code}`,
      ``,
      `Kód platí ${VERIFICATION_TTL_HOURS} hodin. Pokud účet nezakládáte vy, zprávu ignorujte; bez kódu se firma neověří.`,
    ].join("\n"),
  });
  if (sent.status !== "sent") return { status: sent.status === "not_configured" ? "manual" : "unavailable" };

  const { error: storeError } = await identity.service.rpc("start_data_box_verification", {
    target_org: org,
    actor_user: identity.user.id,
    target_data_box: lookup.dataBoxId,
    code_hash: verificationCodeHash({ organizationId: org, code, secret: requireEmailMfaSecret() }),
    expires_at: expiresAt.toISOString(),
  });
  if (storeError) return { status: "unavailable" };
  if (!company.data_box_id) {
    await identity.service.from("organizations").update({ data_box_id: lookup.dataBoxId }).eq("id", org);
  }
  return {
    status: "sent",
    dataBoxId: lookup.dataBoxId,
    expiresAt: expiresAt.toISOString(),
    mismatch: Boolean(company.data_box_id && company.data_box_id.toLowerCase() !== lookup.dataBoxId),
  };
}
