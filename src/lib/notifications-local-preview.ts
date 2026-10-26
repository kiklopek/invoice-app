import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Notification, NotificationFeed, NotificationRead } from "./notifications";

/** Explicit development preview; never a fallback for a failed live database. */
export function localNotificationsPreview(request: Request) {
  return process.env.NODE_ENV === "development" && process.env.LOCAL_NOTIFICATIONS_PREVIEW === "true"
    && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
}
const started = Date.now();
const samples: Notification[] = [
  { id: "00000000-0000-4000-8000-000000000001", type: "invoice_overdue", title: "Faktura po splatnosti", message: "Ukázka: faktura č. 2026001 je po splatnosti. Odtud se otevře její detail.", href: null },
  { id: "00000000-0000-4000-8000-000000000002", type: "payment_review", title: "Platby ve výpisu vyžadují kontrolu", message: "Ukázka: 5 plateb vyžaduje kontrolu přiřazení k fakturám.", href: "/invoices/payments" },
  { id: "00000000-0000-4000-8000-000000000003", type: "invoice_paid", title: "Faktura uhrazena", message: "Ukázka: faktura č. 2026002 byla plně uhrazena.", href: null },
  { id: "00000000-0000-4000-8000-000000000004", type: "reminder_failed", title: "Upomínka nebyla doručena", message: "Ukázka: zkontrolujte e-mailovou adresu odběratele v detailu faktury.", href: null },
  { id: "00000000-0000-4000-8000-000000000005", type: "import_failed", title: "Zpracování dokumentu selhalo", message: "Ukázka: dokument se nepodařilo automaticky zpracovat. Zkontrolujte import faktur.", href: "/invoices/import" },
].map((item, index) => ({ ...item, created_at: new Date(started - (index + 1) * 3600_000).toISOString(), read_at: null })) as Notification[];

type PreviewInvoice = { id: string; invoice_number: string; status: string };
export async function previewInvoiceTargets(service: SupabaseClient<Database>, organizationId: string): Promise<PreviewInvoice[]> {
  const { data, error } = await service.from("invoices").select("id,invoice_number,status")
    .eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(100);
  return error ? [] : data ?? [];
}
function linkInvoiceSamples(invoices: PreviewInvoice[]) {
  return samples.map(item => {
    if (!["invoice_overdue", "invoice_paid", "reminder_failed"].includes(item.type)) return item;
    const status = item.type === "invoice_paid" ? "paid" : "overdue";
    const invoice = invoices.find(value => value.status === status) ?? invoices[0];
    if (!invoice) return { ...item, href: "/invoices", message: "Ukázka: oznámení k faktuře. Otevřít seznam faktur." };
    // The event is illustrative; the destination and its number are real and belong
    // to the authenticated company. Do not claim a sample describes actual status.
    return { ...item, href: `/invoices/${invoice.id}`, message: `Ukázka: oznámení k faktuře č. ${invoice.invoice_number}. Otevřít detail faktury.` };
  });
}
function cookieName(scope: string) {
  return `splatno_notice_preview_${createHash("sha256").update(scope).digest("hex").slice(0, 20)}`;
}
function readIds(request: Request, scope: string): Set<string> {
  const raw = request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(`${cookieName(scope)}=`))?.split("=")[1];
  try {
    const value: unknown = JSON.parse(Buffer.from(raw ?? "", "base64url").toString());
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && samples.some(item => item.id === id)) : []);
  } catch { return new Set(); }
}
export function previewFeed(request: Request, scope: string, options: { unread: boolean; limit: number; beforeTime: string | null; beforeId: string | null }, invoices: PreviewInvoice[] = []) {
  const reads = readIds(request, scope);
  const items = linkInvoiceSamples(invoices).map(item => ({ ...item, read_at: reads.has(item.id) ? item.created_at : null }));
  const filtered = items.filter(item => !options.unread || !item.read_at);
  const page = filtered.filter(item => !options.beforeTime || item.created_at < options.beforeTime || (item.created_at === options.beforeTime && item.id < options.beforeId!));
  return { items: page.slice(0, options.limit), unread_count: items.filter(item => !item.read_at).length, total: filtered.length,
    has_more: page.length > options.limit, through: new Date().toISOString(), preview: true } satisfies Omit<NotificationFeed, "next_cursor">;
}
export function previewRead(request: Request, scope: string, body: NotificationRead) {
  const reads = readIds(request, scope);
  const selected = samples.filter(item => "ids" in body ? body.ids.includes(item.id) : item.created_at <= body.through);
  if ("ids" in body && body.ids.some(id => !samples.some(item => item.id === id))) return NextResponse.json({ error: "Neplatné ukázkové oznámení." }, { status: 400 });
  const changed = selected.filter(item => !reads.has(item.id)).length;
  selected.forEach(item => reads.add(item.id));
  const response = NextResponse.json({ changed }, { headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(cookieName(scope), Buffer.from(JSON.stringify([...reads])).toString("base64url"), { httpOnly: true, sameSite: "strict", path: "/api/notifications", maxAge: 30 * 86400 });
  return response;
}
