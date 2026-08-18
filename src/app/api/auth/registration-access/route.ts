import { NextResponse } from "next/server";
import { isAllowedCorporateEmail, normalizeEmail } from "@/lib/auth-policy";
import { isSameOriginMutation } from "@/lib/request-security";
import { createServiceClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  }

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }

  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  if (!isAllowedCorporateEmail(email)) {
    return NextResponse.json({ error: "Neplatná e-mailová adresa." }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("organization_members")
    .select("id")
    .eq("email", email)
    .limit(1);

  if (error) {
    console.error("Registration membership lookup failed", error);
    return NextResponse.json({ error: "Ověření přístupu se nepodařilo." }, { status: 500 });
  }

  return NextResponse.json({ allowed: Boolean(data?.length) });
}
