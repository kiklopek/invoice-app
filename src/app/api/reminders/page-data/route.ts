import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { PageDataError } from "@/lib/dashboard-page-data";
import { loadReminderPageData } from "@/lib/reminder-page-data";
import { isDemoMode } from "@/lib/supabase-server";

export async function GET() {
  const startedAt = performance.now();
  try {
    const identity = isDemoMode() ? null : await getRequestIdentity();
    const identityDoneAt = performance.now();
    const data = await loadReminderPageData(identity);
    const dataDoneAt = performance.now();
    const result = NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
    const finishedAt = performance.now();
    result.headers.set("server-timing", `auth;dur=${Math.round(identityDoneAt - startedAt)}, data;dur=${Math.round(dataDoneAt - identityDoneAt)}, response;dur=${Math.round(finishedAt - dataDoneAt)}, total;dur=${Math.round(finishedAt - startedAt)}`);
    return result;
  } catch (error) {
    if (error instanceof PageDataError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Upomínky se nepodařilo načíst." }, { status: 500 });
  }
}
