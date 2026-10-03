import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { logError, requestId } from "@/lib/structured-log";
import { runAssistanceJobs } from "@/lib/payment-assistance-server";

export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const service = createServiceClient();
  const { data, error } = await service.rpc("run_bank_reconciliation_jobs");
  if (error) {
    // Bezi jednou denne (Hobby plan povoluje cron nejvyse jednou za den --
    // "*/5 * * * *" tu byl pres tucet commitu a KAZDY nasazeni na produkci
    // od te doby tise selhavalo na "Hobby accounts are limited to cron jobs
    // that run once per day"). Zaucotvava penize. Driv se chyba RPC zahodila
    // beze stopy, takze vypadek mohl trvat tydny, aniz by po nem cokoli
    // zbylo -- navenek jen 500 bez detailu.
    logError("Automatické párování plateb selhalo", error, { request_id: requestId(request) });
    return NextResponse.json({ error: "Zpracování plateb selhalo." }, { status: 500 });
  }
  // The optional worker catches its own failures and never changes v5 results.
  await runAssistanceJobs(service);
  return NextResponse.json({ results: data });
}
