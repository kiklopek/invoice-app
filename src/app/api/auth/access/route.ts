import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  }
  const identity = await getRequestIdentity({ requireMfa: false });
  if (!identity) {
    return NextResponse.json({ error: "Tento účet nemá aktivní přístup do firemní aplikace." }, { status: 403 });
  }
  return NextResponse.json({ allowed: true, role: identity.membership.role });
}
