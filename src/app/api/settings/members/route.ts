import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { nullableRpcString } from "@/lib/supabase-server";
import { canManageMembers } from "@/lib/role-access";

const roles = ["viewer", "accounting", "admin"] as const;
type MemberRole = typeof roles[number];
type AccessEvent = { id: string; actor_email: string; target_email: string; event_type: "added" | "role_changed" | "removed"; previous_role: MemberRole | null; new_role: MemberRole | null; created_at: string };
type MemberRecord = { id: string; email: string; role: MemberRole; user_id: string | null; created_at: string };
type MemberMutation = {
  member?: MemberRecord;
  event?: AccessEvent;
  removed?: boolean;
  id?: string;
  email?: string;
  previous_role?: MemberRole;
  member_user_id?: string | null;
  auth_user_id?: string | null;
  created_at?: string;
};
function validRole(value: unknown): value is MemberRole {
  return typeof value === "string" && roles.includes(value as MemberRole);
}

async function adminIdentity() {
  const identity = await getRequestIdentity();
  if (!identity) return { error: NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 }) };
  if (!canManageMembers(identity.membership.role)) return { error: NextResponse.json({ error: "Přístupy může měnit pouze administrátor." }, { status: 403 }) };
  return { identity };
}

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageMembers(identity.membership.role)) return NextResponse.json({ error: "Přístupy a jejich historii může zobrazit pouze administrátor." }, { status: 403 });
  const [membersResult, eventsResult] = await Promise.all([
    identity.service.from("organization_members").select("id, email, role, user_id, created_at")
      .eq("organization_id", identity.membership.organization_id).order("created_at", { ascending: true }),
    identity.service.from("organization_member_events").select("id, actor_email, target_email, event_type, previous_role, new_role, created_at")
      .eq("organization_id", identity.membership.organization_id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(10),
  ]);
  if (membersResult.error || eventsResult.error) {
    logError("Seznam přístupů se nepodařilo načíst", membersResult.error ?? eventsResult.error);
    return apiError(request, "Seznam přístupů se nepodařilo načíst. Zkuste to prosím znovu za chvíli.", 500, "members_read_failed");
  }
  return NextResponse.json({
    members: (membersResult.data ?? []).map(member => ({ id: member.id, email: member.email, role: member.role, active: Boolean(member.user_id), current: member.id === identity.membership.id, created_at: member.created_at })),
    access_events: eventsResult.data ?? [],
    current_role: identity.membership.role,
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { email?: unknown; role?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !validRole(body?.role)) return NextResponse.json({ error: "Zkontrolujte e-mail a vybranou roli." }, { status: 400 });
  const result = await adminIdentity();
  if (result.error) return result.error;
  const { identity } = result;
  const { data, error } = await identity.service.rpc("add_organization_member", { target_org: identity.membership.organization_id, new_email: email, new_role: body.role, actor_user: identity.user.id });
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Tento e-mail už přístup má." : "Přístup se nepodařilo přidat." }, { status: error.code === "23505" ? 409 : 500 });
  const mutation = data as MemberMutation | null;
  if (!mutation?.member) {
    // Bez e-mailu: adresa člena je identitní údaj a do logu nepatří.
    logError("Přidání přístupu nevrátilo potvrzeného člena", null);
    return apiError(request, "Přístup se nepodařilo bezpečně potvrdit.", 500, "member_add_unconfirmed");
  }
  return NextResponse.json({ member: { ...mutation.member, active: Boolean(mutation.member.user_id), current: false }, access_event: mutation.event }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: unknown; role?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id || !validRole(body?.role)) return NextResponse.json({ error: "Neplatný člen nebo role." }, { status: 400 });
  const result = await adminIdentity();
  if (result.error) return result.error;
  const { identity } = result;
  const { data, error } = await identity.service.rpc("update_organization_member_role", {
    target_org: identity.membership.organization_id,
    target_member: id,
    new_role: body.role,
    actor_user: identity.user.id,
  });
  if (error) {
    if (error.message.includes("last_admin")) return NextResponse.json({ error: "Organizace musí mít alespoň jednoho administrátora." }, { status: 409 });
    if (error.message.includes("member_not_found")) return NextResponse.json({ error: "Uživatel nebyl nalezen." }, { status: 404 });
    logError("Změna role člena selhala", error, { member_id: id });
    return apiError(request, "Roli se nepodařilo změnit.", 500, "member_role_change_failed");
  }
  const mutation = data as MemberMutation | null;
  const { data: confirmedMember, error: confirmationError } = await identity.service
    .from("organization_members")
    .select("id, email, role, user_id, created_at")
    .eq("organization_id", identity.membership.organization_id)
    .eq("id", id)
    .maybeSingle();
  if (confirmationError) {
    logError("Potvrzení změněné role selhalo", confirmationError, { member_id: id });
    return apiError(request, "Roli se nepodařilo bezpečně potvrdit.", 500, "member_role_unconfirmed");
  }
  if (!confirmedMember) return NextResponse.json({ error: "Uživatel nebyl nalezen." }, { status: 404 });
  return NextResponse.json({ member: { ...confirmedMember, active: Boolean(confirmedMember.user_id), current: id === identity.membership.id }, access_event: mutation?.event ?? null });
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Chybí uživatel." }, { status: 400 });
  const result = await adminIdentity();
  if (result.error) return result.error;
  const { identity } = result;
  if (id === identity.membership.id) return NextResponse.json({ error: "Nemůžete odebrat vlastní přístup." }, { status: 409 });
  const { data, error } = await identity.service.rpc("delete_organization_member", {
    target_org: identity.membership.organization_id,
    target_member: id,
    actor_user: identity.user.id,
  });
  if (error) {
    if (error.message.includes("cannot_remove_self")) return NextResponse.json({ error: "Nemůžete odebrat vlastní přístup." }, { status: 409 });
    if (error.message.includes("last_admin")) return NextResponse.json({ error: "Posledního administrátora nelze odebrat." }, { status: 409 });
    if (error.message.includes("member_not_found")) return NextResponse.json({ error: "Uživatel nebyl nalezen." }, { status: 404 });
    logError("Odebrání přístupu selhalo", error, { member_id: id });
    return apiError(request, "Přístup se nepodařilo odebrat.", 500, "member_remove_failed");
  }
  const mutation = data as MemberMutation | null;
  if (!mutation?.removed || !mutation.email || !mutation.previous_role || !mutation.created_at) {
    logError("Odebrání přístupu nevrátilo úplný výsledek", null, { member_id: id });
    return apiError(request, "Odebrání přístupu se nepodařilo bezpečně potvrdit.", 500, "member_remove_unconfirmed");
  }

  if (mutation.auth_user_id) {
    const { error: authDeleteError } = await identity.service.auth.admin.deleteUser(mutation.auth_user_id, false);
    if (authDeleteError) {
      logError("Smazání přihlašovacího účtu selhalo", authDeleteError, { member_id: id });
      const { error: restoreError } = await identity.service.rpc("restore_organization_member_after_auth_delete_failure", {
        target_org: identity.membership.organization_id,
        target_member: id,
        target_user: nullableRpcString(mutation.member_user_id ?? null),
        target_email: mutation.email,
        target_role: mutation.previous_role,
        target_created: mutation.created_at,
        actor_user: identity.user.id,
      });
      if (restoreError) logError("Obnovení přístupu po neúspěšném smazání účtu selhalo", restoreError, { member_id: id });
      return apiError(
        request,
        restoreError
          ? "Účet se nepodařilo úplně smazat a přístup vyžaduje kontrolu administrátora."
          : "Přihlašovací účet se nepodařilo smazat, proto byl přístup obnoven. Zkuste odebrání znovu.",
        500,
        restoreError ? "member_auth_delete_unrecovered" : "member_auth_delete_failed",
      );
    }
  }

  const { data: remainingMember, error: confirmationError } = await identity.service
    .from("organization_members")
    .select("id")
    .eq("organization_id", identity.membership.organization_id)
    .eq("id", id)
    .maybeSingle();
  if (confirmationError) {
    logError("Potvrzení odebrání přístupu selhalo", confirmationError, { member_id: id });
    return apiError(request, "Odebrání přístupu se nepodařilo bezpečně potvrdit.", 500, "member_remove_unconfirmed");
  }
  if (remainingMember) {
    logError("Člen zůstal po odebrání aktivní", null, { member_id: id });
    return apiError(request, "Přístup zůstal aktivní. Zkuste odebrání znovu.", 500, "member_still_active");
  }
  return NextResponse.json({ removed: true, auth_account_deleted: Boolean(mutation.auth_user_id), access_event: mutation.event ?? null });
}
