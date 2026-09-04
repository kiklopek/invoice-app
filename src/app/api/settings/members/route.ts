import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { isDemoMode, nullableRpcString } from "@/lib/supabase-server";
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
const demoMembers = [
  { id: "demo-admin", email: "kostihova@hlavica.cz", role: "admin", active: true, current: true, created_at: "2026-01-01T08:00:00Z" },
  { id: "demo-accounting", email: "ucetni@hlavica.cz", role: "accounting", active: false, current: false, created_at: "2026-01-02T08:00:00Z" },
];
const demoAccessEvents: AccessEvent[] = [
  { id: "demo-access-1", actor_email: "kostihova@hlavica.cz", target_email: "ucetni@hlavica.cz", event_type: "added", previous_role: null, new_role: "accounting", created_at: "2026-08-04T08:15:00Z" },
];

function validRole(value: unknown): value is MemberRole {
  return typeof value === "string" && roles.includes(value as MemberRole);
}

async function adminIdentity() {
  const identity = await getRequestIdentity();
  if (!identity) return { error: NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 }) };
  if (!canManageMembers(identity.membership.role)) return { error: NextResponse.json({ error: "Přístupy může měnit pouze administrátor." }, { status: 403 }) };
  return { identity };
}

export async function GET() {
  if (isDemoMode()) return NextResponse.json({ members: demoMembers, access_events: demoAccessEvents, current_role: "admin" });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageMembers(identity.membership.role)) return NextResponse.json({ error: "Přístupy a jejich historii může zobrazit pouze administrátor." }, { status: 403 });
  const [membersResult, eventsResult] = await Promise.all([
    identity.service.from("organization_members").select("id, email, role, user_id, created_at")
      .eq("organization_id", identity.membership.organization_id).order("created_at", { ascending: true }),
    identity.service.from("organization_member_events").select("id, actor_email, target_email, event_type, previous_role, new_role, created_at")
      .eq("organization_id", identity.membership.organization_id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(10),
  ]);
  if (membersResult.error || eventsResult.error) return NextResponse.json({ error: "Seznam přístupů se nepodařilo načíst. Zkontrolujte databázovou migraci." }, { status: 500 });
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
  if (isDemoMode()) {
    const id = crypto.randomUUID(); const created_at = new Date().toISOString();
    return NextResponse.json({ member: { id, email, role: body.role, active: false, current: false, created_at }, access_event: { id: crypto.randomUUID(), actor_email: "kostihova@hlavica.cz", target_email: email, event_type: "added", previous_role: null, new_role: body.role, created_at } }, { status: 201 });
  }
  const result = await adminIdentity();
  if (result.error) return result.error;
  const { identity } = result;
  const { data, error } = await identity.service.rpc("add_organization_member", { target_org: identity.membership.organization_id, new_email: email, new_role: body.role, actor_user: identity.user.id });
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Tento e-mail už přístup má." : "Přístup se nepodařilo přidat." }, { status: error.code === "23505" ? 409 : 500 });
  const mutation = data as MemberMutation | null;
  if (!mutation?.member) return NextResponse.json({ error: "Přístup se nepodařilo bezpečně potvrdit." }, { status: 500 });
  return NextResponse.json({ member: { ...mutation.member, active: Boolean(mutation.member.user_id), current: false }, access_event: mutation.event }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: unknown; role?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id || !validRole(body?.role)) return NextResponse.json({ error: "Neplatný člen nebo role." }, { status: 400 });
  if (isDemoMode()) {
    if (id === "demo-admin" && body.role !== "admin") return NextResponse.json({ error: "Organizace musí mít alespoň jednoho administrátora." }, { status: 409 });
    const member = demoMembers.find(item => item.id === id);
    return member ? NextResponse.json({ member: { ...member, role: body.role }, access_event: { id: crypto.randomUUID(), actor_email: "kostihova@hlavica.cz", target_email: member.email, event_type: "role_changed", previous_role: member.role, new_role: body.role, created_at: new Date().toISOString() } }) : NextResponse.json({ error: "Uživatel nebyl nalezen." }, { status: 404 });
  }
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
    return NextResponse.json({ error: "Roli se nepodařilo změnit." }, { status: 500 });
  }
  const mutation = data as MemberMutation | null;
  const { data: confirmedMember, error: confirmationError } = await identity.service
    .from("organization_members")
    .select("id, email, role, user_id, created_at")
    .eq("organization_id", identity.membership.organization_id)
    .eq("id", id)
    .maybeSingle();
  if (confirmationError) {
    console.error("Member role confirmation failed", confirmationError);
    return NextResponse.json({ error: "Roli se nepodařilo bezpečně potvrdit." }, { status: 500 });
  }
  if (!confirmedMember) return NextResponse.json({ error: "Uživatel nebyl nalezen." }, { status: 404 });
  return NextResponse.json({ member: { ...confirmedMember, active: Boolean(confirmedMember.user_id), current: id === identity.membership.id }, access_event: mutation?.event ?? null });
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Chybí uživatel." }, { status: 400 });
  if (isDemoMode()) {
    const member = demoMembers.find(item => item.id === id);
    return id === "demo-admin" ? NextResponse.json({ error: "Nemůžete odebrat vlastní přístup." }, { status: 409 }) : NextResponse.json({ removed: true, access_event: member ? { id: crypto.randomUUID(), actor_email: "kostihova@hlavica.cz", target_email: member.email, event_type: "removed", previous_role: member.role, new_role: null, created_at: new Date().toISOString() } : null });
  }
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
    return NextResponse.json({ error: "Přístup se nepodařilo odebrat." }, { status: 500 });
  }
  const mutation = data as MemberMutation | null;
  if (!mutation?.removed || !mutation.email || !mutation.previous_role || !mutation.created_at) {
    return NextResponse.json({ error: "Odebrání přístupu se nepodařilo bezpečně potvrdit." }, { status: 500 });
  }

  if (mutation.auth_user_id) {
    const { error: authDeleteError } = await identity.service.auth.admin.deleteUser(mutation.auth_user_id, false);
    if (authDeleteError) {
      console.error("Auth user deletion failed", authDeleteError);
      const { error: restoreError } = await identity.service.rpc("restore_organization_member_after_auth_delete_failure", {
        target_org: identity.membership.organization_id,
        target_member: id,
        target_user: nullableRpcString(mutation.member_user_id ?? null),
        target_email: mutation.email,
        target_role: mutation.previous_role,
        target_created: mutation.created_at,
        actor_user: identity.user.id,
      });
      if (restoreError) console.error("Member restoration after Auth deletion failure failed", restoreError);
      return NextResponse.json({
        error: restoreError
          ? "Účet se nepodařilo úplně smazat a přístup vyžaduje kontrolu administrátora."
          : "Přihlašovací účet se nepodařilo smazat, proto byl přístup obnoven. Zkuste odebrání znovu.",
      }, { status: 500 });
    }
  }

  const { data: remainingMember, error: confirmationError } = await identity.service
    .from("organization_members")
    .select("id")
    .eq("organization_id", identity.membership.organization_id)
    .eq("id", id)
    .maybeSingle();
  if (confirmationError) {
    console.error("Member removal confirmation failed", confirmationError);
    return NextResponse.json({ error: "Odebrání přístupu se nepodařilo bezpečně potvrdit." }, { status: 500 });
  }
  if (remainingMember) return NextResponse.json({ error: "Přístup zůstal aktivní. Zkuste odebrání znovu." }, { status: 500 });
  return NextResponse.json({ removed: true, auth_account_deleted: Boolean(mutation.auth_user_id), access_event: mutation.event ?? null });
}
