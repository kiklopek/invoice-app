import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { getRequestIdentity } from "@/lib/auth";
import { parseDashboardRange } from "@/lib/dashboard-period";
import type { DashboardData } from "@/lib/dashboard-summary";
import {
  loadDashboardPageData,
  PageDataError,
} from "@/lib/dashboard-page-data";

const response = (data: DashboardData, serverTiming?: string) =>
  NextResponse.json(data, {
    headers: {
      "cache-control": "private, no-store",
      ...(serverTiming ? { "server-timing": serverTiming } : {}),
    },
  });

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const identity = await getRequestIdentity();
    const identityDoneAt = performance.now();
    const params = new URL(request.url).searchParams;
    const scoped = params.has("from") || params.has("to");
    const range = scoped ? parseDashboardRange(params) : undefined;
    if (range === null)
      return NextResponse.json(
        { error: "Neplatné období přehledu." },
        { status: 400 },
      );
    const data = await loadDashboardPageData(identity, range);
    const dataDoneAt = performance.now();
    const result = response(data);
    const finishedAt = performance.now();
    result.headers.set(
      "server-timing",
      `auth;dur=${Math.round(identityDoneAt - startedAt)}, data;dur=${Math.round(dataDoneAt - identityDoneAt)}, response;dur=${Math.round(finishedAt - dataDoneAt)}, total;dur=${Math.round(finishedAt - startedAt)}`,
    );
    return result;
  } catch (error) {
    if (error instanceof PageDataError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    logError("Přehled se nepodařilo načíst", error);
    return apiError(
      request,
      "Přehled se nepodařilo načíst.",
      500,
      "dashboard_read_failed",
    );
  }
}
