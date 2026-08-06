import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { parseResendDeliveryEvent } from "@/lib/resend-webhook";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
const MAX_WEBHOOK_BYTES = 128 * 1024;

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook není nakonfigurovaný." }, { status: 503 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook je příliš velký." }, { status: 413 });
  }
  const rawPayload = await request.text();
  if (!rawPayload || new TextEncoder().encode(rawPayload).byteLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook je prázdný nebo příliš velký." }, { status: 400 });
  }

  const svixId = request.headers.get("svix-id") ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
  const svixSignature = request.headers.get("svix-signature") ?? "";
  if (!svixId || svixId.length > 200 || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Chybí podpis webhooku." }, { status: 400 });
  }

  let verified: unknown;
  try {
    verified = new Webhook(secret).verify(rawPayload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch {
    return NextResponse.json({ error: "Neplatný podpis webhooku." }, { status: 400 });
  }

  const event = parseResendDeliveryEvent(verified);
  if (!event) return NextResponse.json({ ignored: true });

  const db = createServiceClient();
  const { data, error } = await db.rpc("process_resend_delivery_event", {
    webhook_event_id: svixId,
    webhook_event_type: event.type,
    message_id: event.emailId,
    event_time: event.createdAt,
    event_error: event.error,
  });
  if (error) return NextResponse.json({ error: "Událost se nepodařilo bezpečně uložit." }, { status: 500 });
  const result = data && typeof data === "object" ? data as { matched?: boolean; duplicate?: boolean } : null;
  // Webhook může předběhnout zápis provider_message_id po úspěšném sendu. Čerstvou
  // událost necháme zopakovat; databázové RPC znovu páruje i stejné svix-id.
  if (result?.matched === false && Date.now() - Date.parse(event.createdAt) < 5 * 60_000) {
    return NextResponse.json({ error: "Odeslání ještě není připravené ke spárování." }, { status: 503 });
  }
  return NextResponse.json({ received: true, ...data });
}
