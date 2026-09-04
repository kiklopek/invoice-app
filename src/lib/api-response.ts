import "server-only";

import { NextResponse } from "next/server";
import { requestId } from "@/lib/structured-log";

export function apiError(
  request: Request,
  error: string,
  status: number,
  code: string,
  details: Record<string, unknown> = {},
) {
  const id = requestId(request);
  return NextResponse.json(
    { ...details, error, code, request_id: id },
    { status, headers: { "x-request-id": id } },
  );
}
