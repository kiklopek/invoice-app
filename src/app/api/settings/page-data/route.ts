import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { getRequestIdentity } from "@/lib/auth";
import { PageDataError } from "@/lib/dashboard-page-data";
import { loadSettingsPageData } from "@/lib/settings-page-data";

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const identity = await getRequestIdentity();
    const identityDoneAt = performance.now();
    const data = await loadSettingsPageData(identity);
    const dataDoneAt = performance.now();
    const result = NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
    const finishedAt = performance.now();
    result.headers.set("server-timing", `auth;dur=${Math.round(identityDoneAt - startedAt)}, data;dur=${Math.round(dataDoneAt - identityDoneAt)}, response;dur=${Math.round(finishedAt - dataDoneAt)}, total;dur=${Math.round(finishedAt - startedAt)}`);
    return result;
  } catch (error) {
    if (error instanceof PageDataError) return NextResponse.json({ error: error.message }, { status: error.status });
    logError("Data stránky nastavení se nepodařilo načíst", error);
    return apiError(request, "Nastavení se nepodařilo načíst.", 500, "settings_page_data_failed");
  }
}
