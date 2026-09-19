import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await createServiceClient().rpc("run_bank_reconciliation_jobs");
  if (error) return NextResponse.json({ error: "Zpracování plateb selhalo." }, { status: 500 });
  return NextResponse.json({ results: data });
}
