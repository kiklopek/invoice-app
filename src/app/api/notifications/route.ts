import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isSameOriginMutation } from "@/lib/request-security";
import { logError } from "@/lib/structured-log";
import type { NotificationFeed } from "@/lib/notifications";

import { localNotificationsPreview, previewFeed, previewRead, previewInvoiceTargets } from "@/lib/notifications-local-preview";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity) return apiError(request, "Nejste přihlášený uživatel.", 401, "unauthenticated");
  const query = new URL(request.url).searchParams;
  const limit = Number(query.get("limit") ?? 8);
  const unread = query.get("unread");
  let beforeTime: string | null = null, beforeId: string | null = null;
  if (query.has("cursor")) {
    try {
      const cursor = query.get("cursor")!;
      if (cursor.length > 200) throw new Error();
      const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!Array.isArray(parsed) || parsed.length !== 2 || !validDate(parsed[0]) || typeof parsed[1] !== "string" || !uuid.test(parsed[1])) throw new Error();
      [beforeTime, beforeId] = parsed;
    } catch { return apiError(request, "Neplatná stránka oznámení.", 400, "invalid_cursor"); }
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (unread !== null && unread !== "true" && unread !== "false"))
    return apiError(request, "Neplatný filtr oznámení.", 400, "invalid_filter");
  if (localNotificationsPreview(request)) {
    const invoices = await previewInvoiceTargets(identity.service, identity.membership.organization_id);
    const feed = previewFeed(request, `${identity.membership.organization_id}:${identity.user.id}`, { unread: unread === "true", limit, beforeTime, beforeId }, invoices);
    const last = feed.items.at(-1);
    return NextResponse.json({ ...feed, next_cursor: feed.has_more && last ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString("base64url") : null }, { headers });
  }
  const { data, error } = await identity.service.rpc("notification_feed", {
    target_org: identity.membership.organization_id, actor_user: identity.user.id,
    only_unread: unread === "true", page_size: limit, before_time: beforeTime, before_id: beforeId,
  });
  if (error || !data) {
    logError("Oznámení se nepodařilo načíst", error);
    return apiError(request, "Oznámení se nepodařilo načíst.", error?.code === "42501" ? 403 : 503, "notifications_unavailable");
  }
  const feed = data as unknown as NotificationFeed;
  const last = feed.items.at(-1);
  return NextResponse.json({ ...feed, next_cursor: feed.has_more && last ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString("base64url") : null }, { headers });
}
export async function PATCH(request: Request) {
  if (!isSameOriginMutation(request)) return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "invalid_origin");
  const identity = await getRequestIdentity();
  if (!identity) return apiError(request, "Nejste přihlášený uživatel.", 401, "unauthenticated");
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(request, "Neplatné oznámení.", 400, "invalid_body");
  const single = Array.isArray(body.ids) && body.ids.length > 0 && body.ids.length <= 50 && body.ids.every((id: unknown) => typeof id === "string" && uuid.test(id));
  const all = body.all === true && validDate(body.through);
  if ((single && all) || (!single && !all) || (single && (body.all !== undefined || body.through !== undefined)) || (all && body.ids !== undefined))
    return apiError(request, "Neplatné oznámení.", 400, "invalid_body");
  if (localNotificationsPreview(request)) return previewRead(request, `${identity.membership.organization_id}:${identity.user.id}`, single ? { ids: body.ids } : { all: true, through: body.through });
  const { data, error } = await identity.service.rpc("read_notifications", {
    target_org: identity.membership.organization_id, actor_user: identity.user.id,
    event_ids: single ? body.ids : null, through_time: all ? body.through : null,
  });
  if (error) {
    logError("Oznámení se nepodařilo označit", error);
    return apiError(request, "Oznámení se nepodařilo označit jako přečtené.", error.code === "42501" ? 403 : 500, "notification_read_failed");
  }
  return NextResponse.json({ changed: data }, { headers });
}
