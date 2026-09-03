import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { setLoginSessionPreference } from "@/lib/login-session-server";
import { isSameOriginMutation } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  }

  const identity = await getRequestIdentity({ requireMfa: false, requireLoginSession: false });
  if (!identity) {
    return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { remember?: unknown } | null;
  if (typeof body?.remember !== "boolean") {
    return NextResponse.json({ error: "Neplatná volba přihlášení." }, { status: 400 });
  }

  await setLoginSessionPreference(body.remember);
  return NextResponse.json({ saved: true });
}
