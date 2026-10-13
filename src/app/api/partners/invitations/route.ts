import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { issueAndSendNetworkInvitation } from "@/lib/network-invitation-server";
import { isLookupIco, normalizeIcoInput } from "@/lib/partner-network";
import { isSameOriginMutation } from "@/lib/request-security";
import { canManageNetwork } from "@/lib/role-access";
import { logError } from "@/lib/structured-log";

// Pozvánka firmy, která Splatno nepoužívá. Odesílá e-mail třetí straně, proto
// ji klient posílá až po potvrzení s uvedením adresáta (confirmAction).
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { ico?: unknown; email?: unknown } | null;
  const ico = typeof body?.ico === "string" ? normalizeIcoInput(body.ico) : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isLookupIco(ico)) return NextResponse.json({ error: "Zadejte platné IČO (8 číslic s kontrolní číslicí)." }, { status: 400 });
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Zadejte platnou e-mailovou adresu." }, { status: 400 });
  }

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageNetwork(identity.membership.role)) {
    return NextResponse.json({ error: "Pozvánky do sítě může posílat pouze administrátor." }, { status: 403 });
  }

  try {
    const delivery = await issueAndSendNetworkInvitation(identity, ico, email);
    if (delivery.sent) return NextResponse.json({ sent: true, email: delivery.email });
    if (delivery.status >= 500) {
      logError("Pozvánka do sítě neodešla", null, { code: delivery.code });
      return apiError(request, delivery.message, delivery.status, delivery.code);
    }
    return NextResponse.json({ error: delivery.message, code: delivery.code }, { status: delivery.status });
  } catch (error) {
    logError("Pozvánku do sítě se nepodařilo odeslat", error);
    return apiError(request, "Pozvánku se nepodařilo odeslat.", 500, "network_invitation_failed");
  }
}
