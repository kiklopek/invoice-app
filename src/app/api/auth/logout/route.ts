import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/request-security";
import { createUserServerClient, isDemoMode } from "@/lib/supabase-server";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  if (!isDemoMode()) {
    const supabase = await createUserServerClient();
    await supabase.auth.signOut();
  }
  return NextResponse.json({ signed_out: true });
}

