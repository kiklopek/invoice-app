import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import { PageDataError } from "@/lib/dashboard-page-data";
import { canManageMembers, canViewCompanySettings, type AccessRole } from "@/lib/role-access";
import { isDemoMode } from "@/lib/supabase-server";

export type CompanySettings = { name: string; ico: string; dic: string; registered_address: string; operating_address: string; data_box_id: string; phone: string; email: string; bank_account_czk: string; bank_account_eur: string };
export type SettingsMember = { id: string; email: string; role: AccessRole; active: boolean; current: boolean; created_at: string };
export type SettingsAccessEvent = { id: string; actor_email: string; target_email: string; event_type: "added" | "role_changed" | "removed"; previous_role: AccessRole | null; new_role: AccessRole | null; created_at: string };
export type SettingsPageData = { company: CompanySettings; members: SettingsMember[]; access_events: SettingsAccessEvent[]; current_role: AccessRole };

export const emptyCompanySettings: CompanySettings = { name: "", ico: "", dic: "", registered_address: "", operating_address: "", data_box_id: "", phone: "", email: "", bank_account_czk: "", bank_account_eur: "" };
const demoCompany: CompanySettings = { name: "R. Hlavica s.r.o.", ico: "26296039", dic: "CZ26296039", registered_address: "Palackého třída 192/60, Brno-Královo Pole, 612 00", operating_address: "Podhradní Lhota 193, Rajnochovice, 768 71", data_box_id: "87qv26b", phone: "+420 573 500 700", email: "kostihova@hlavica.cz", bank_account_czk: "6844160247/0100", bank_account_eur: "94-2613370257/0100" };

export async function loadSettingsPageData(identity: RequestIdentity | null): Promise<SettingsPageData> {
  if (isDemoMode()) return {
    company: demoCompany,
    members: [
      { id: "demo-admin", email: "kostihova@hlavica.cz", role: "admin", active: true, current: true, created_at: "2026-01-01T08:00:00Z" },
      { id: "demo-accounting", email: "ucetni@hlavica.cz", role: "accounting", active: false, current: false, created_at: "2026-01-02T08:00:00Z" },
    ],
    access_events: [{ id: "demo-access-1", actor_email: "kostihova@hlavica.cz", target_email: "ucetni@hlavica.cz", event_type: "added", previous_role: null, new_role: "accounting", created_at: "2026-08-04T08:15:00Z" }],
    current_role: "admin",
  };
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);
  if (!canViewCompanySettings(identity.membership.role)) throw new PageDataError("K nastavení firmy nemáte přístup.", 403);
  const org = identity.membership.organization_id;
  const companyPromise = identity.service.from("organizations").select("name, ico, dic, registered_address, operating_address, data_box_id, phone, email, bank_account_czk, bank_account_eur").eq("id", org).single();
  const membersPromise = canManageMembers(identity.membership.role)
    ? identity.service.from("organization_members").select("id, email, role, user_id, created_at").eq("organization_id", org).order("created_at", { ascending: true })
    : Promise.resolve({ data: [], error: null });
  const eventsPromise = canManageMembers(identity.membership.role)
    ? identity.service.from("organization_member_events").select("id, actor_email, target_email, event_type, previous_role, new_role, created_at").eq("organization_id", org).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(10)
    : Promise.resolve({ data: [], error: null });
  const [companyResult, membersResult, eventsResult] = await Promise.all([companyPromise, membersPromise, eventsPromise]);
  if (companyResult.error || membersResult.error || eventsResult.error) throw new PageDataError("Nastavení se nepodařilo načíst. Zkontrolujte databázovou migraci.", 500);
  return {
    company: (companyResult.data ?? emptyCompanySettings) as CompanySettings,
    members: (membersResult.data ?? []).map(member => ({ id: member.id, email: member.email, role: member.role as AccessRole, active: Boolean(member.user_id), current: member.id === identity.membership.id, created_at: member.created_at })),
    access_events: (eventsResult.data ?? []) as SettingsAccessEvent[],
    current_role: identity.membership.role,
  };
}
