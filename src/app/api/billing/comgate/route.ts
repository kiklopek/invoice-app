import { NextResponse } from "next/server";
import { isComgateSecret } from "@/lib/comgate";
import { syncCardPayment } from "@/lib/billing-server";
import { logError } from "@/lib/structured-log";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Oznámení od Comgate o změně platby. Ověří se tajemstvím obchodu, ale tarif
// se aktivuje až podle stavu načteného přímo z Comgate (syncCardPayment) --
// samotnému oznámení se nevěří. Vždy odpovídá 200, aby brána neopakovala
// zprávu donekonečna; chyby jdou do logu.
export async function POST(request: Request) {
  const raw = await request.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = Object.fromEntries(new URLSearchParams(raw));
  }
  if (!isComgateSecret(body.secret)) {
    logError("Oznámení Comgate s neplatným tajemstvím", null);
    return NextResponse.json({ code: 1400, message: "Unauthorized" }, { status: 401 });
  }
  const refId = typeof body.refId === "string" ? body.refId : "";
  if (!UUID_RE.test(refId)) return NextResponse.json({ code: 0, message: "OK" });
  const result = await syncCardPayment(refId);
  if (result.state === "mismatch") logError("Oznámení Comgate nesedí k objednávce", null, { order_id: refId });
  return NextResponse.json({ code: 0, message: "OK" });
}
