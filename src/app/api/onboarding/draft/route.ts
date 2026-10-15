import { NextResponse } from "next/server";
import { getAuthenticatedSession, resolveMembership } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { MAX_DRAFT_BYTES, normalizeOnboardingDraft } from "@/lib/onboarding-draft";
import { isSameOriginMutation } from "@/lib/request-security";
import { logError, requestId } from "@/lib/structured-log";
import type { Json } from "@/types/database";

export async function PUT(request: Request) {
  if (!isSameOriginMutation(request)) return apiError(request, "Nepovolený původ požadavku.", 403, "origin_denied");
  const session = await getAuthenticatedSession();
  if (!session) return apiError(request, "Nejste přihlášený uživatel.", 401, "unauthorized");
  if (await resolveMembership(session)) return NextResponse.json({ saved: false, code: "already_member" }, { status: 409 });
  // Read with a bound even when the client omits or forges Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ saved: false }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > MAX_DRAFT_BYTES) { await reader.cancel(); return NextResponse.json({ saved: false }, { status: 413 }); }
    chunks.push(chunk.value);
  }
  let draft;
  try { draft = normalizeOnboardingDraft(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch { draft = null; }
  if (!draft) return NextResponse.json({ saved: false, code: "invalid_draft" }, { status: 400 });
  const { error } = await session.service.from("onboarding_drafts").upsert({
    user_id: session.user.id, payload: draft as unknown as Json, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) {
    logError("Uložení rozpracovaného onboardingu selhalo", error, { request_id: requestId(request) });
    return apiError(request, "Rozpracované nastavení se nepodařilo uložit k účtu.", 503, "draft_save_failed");
  }
  return NextResponse.json({ saved: true }, { headers: { "cache-control": "private, no-store" } });
}
