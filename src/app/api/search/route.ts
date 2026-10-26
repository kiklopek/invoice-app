import { apiError } from "@/lib/api-response";
import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { PageDataError } from "@/lib/dashboard-page-data";
import { parseWorkspaceSearch } from "@/lib/workspace-search";
import { loadWorkspaceSearch } from "@/lib/workspace-search-data";
import { logError, requestId } from "@/lib/structured-log";

export async function GET(request: Request) {
  const headers = { "cache-control": "private, no-store" };
  try {
    const identity = await getRequestIdentity();
    if (!identity)
      return NextResponse.json(
        { error: "Nejste přihlášený uživatel." },
        { status: 401, headers },
      );
    const query = parseWorkspaceSearch(
      new URL(request.url).searchParams.get("q"),
    );
    if (query === null)
      return NextResponse.json(
        { error: "Vyhledávací dotaz je neplatný nebo příliš dlouhý." },
        { status: 400, headers },
      );
    return NextResponse.json(await loadWorkspaceSearch(identity, query), {
      headers,
    });
  } catch (error) {
    if (error instanceof PageDataError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers },
      );
    logError("Globální vyhledávání selhalo", error, { request_id: requestId(request) });
    return apiError(request, "Vyhledávání se nepodařilo načíst.", 500, "workspace_search_failed");
  }
}
