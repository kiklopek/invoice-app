import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { isDemoMode } from "@/lib/supabase-server";
import { displayName } from "@/lib/user-display";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  }
  if (isDemoMode()) {
    return NextResponse.json({ allowed: true, role: "admin", name: "Demo administrátor", email: "kostihova@hlavica.cz" });
  }
  const identity = await getRequestIdentity({ requireMfa: false });
  if (!identity) {
    return NextResponse.json({ error: "Tento účet nemá aktivní přístup do firemní aplikace." }, { status: 403 });
  }
  const email = identity.user.email?.trim().toLowerCase() || identity.membership.email;
  return NextResponse.json({
    allowed: true,
    role: identity.membership.role,
    name: displayName(identity.user.user_metadata.full_name, email),
    email,
  });
}
