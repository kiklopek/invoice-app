import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { isdsConfiguration } from "@/lib/isds";

// Stav ověření firmy pro onboarding, Nastavení a stránku Koupit.
export async function GET() {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  const org = identity.membership.organization_id;
  const [{ data: company }, { data: pending }] = await Promise.all([
    identity.service.from("organizations").select("verified_at, data_box_id").eq("id", org).single(),
    identity.service.from("organization_verifications").select("data_box_id, expires_at, attempts")
      .eq("organization_id", org).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return NextResponse.json({
    verified_at: company?.verified_at ?? null,
    pending: pending && pending.expires_at && new Date(pending.expires_at) > new Date() && pending.attempts < 5
      ? { data_box_id: pending.data_box_id, expires_at: pending.expires_at }
      : null,
    automatic: Boolean(isdsConfiguration()),
  }, { headers: { "cache-control": "private, no-store" } });
}
