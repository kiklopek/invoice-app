"use client";

import { useEffect, useState } from "react";
import { AppFrame } from "@/components/app-sidebar";
import { MobileDisclosure } from "@/components/mobile-disclosure";
import { useAccessProfile } from "@/lib/use-access-role";
import { canEditCompanySettings } from "@/lib/role-access";
import { confirmAction } from "@/lib/confirm-action";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { signOutAllSessions } from "@/lib/sign-out";

type Company = { name: string; ico: string; dic: string; registered_address: string; operating_address: string; data_box_id: string; phone: string; email: string; bank_account_czk: string; bank_account_eur: string };
type Role = "viewer" | "accounting" | "admin";
type Member = { id: string; email: string; role: Role; active: boolean; current: boolean; created_at: string };
type AccessEvent = { id: string; actor_email: string; target_email: string; event_type: "added" | "role_changed" | "removed"; previous_role: Role | null; new_role: Role | null; created_at: string };
const empty: Company = { name: "", ico: "", dic: "", registered_address: "", operating_address: "", data_box_id: "", phone: "", email: "", bank_account_czk: "", bank_account_eur: "" };
const roleNames: Record<Role, string> = { admin: "Administrátor", accounting: "Účetní", viewer: "Čtenář" };
const accessAction = (event: AccessEvent) => event.event_type === "added" ? `přidal přístup · ${roleNames[event.new_role!]}`
  : event.event_type === "removed" ? `odebral přístup · ${roleNames[event.previous_role!]}`
  : `změnil roli · ${roleNames[event.previous_role!]} → ${roleNames[event.new_role!]}`;
const formatAuditDate = (value: string) => new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

export default function SettingsPage() {
  const [company, setCompany] = useState<Company>(empty);
  const [members, setMembers] = useState<Member[]>([]);
  const [accessEvents, setAccessEvents] = useState<AccessEvent[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("accounting");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const profile = useAccessProfile();
  const currentRole = profile?.role ?? null;
  const canAdminister = canEditCompanySettings(currentRole);
  useUnsavedChanges(dirty && !saving);

  async function refreshMembers() {
    const response = await fetch("/api/settings/members", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setMembers(data.members ?? []);
    setAccessEvents(data.access_events ?? []);
  }

  useEffect(() => {
    if (!currentRole) return;
    if (currentRole === "viewer") { setLoading(false); return; }
    const urls = currentRole === "admin" ? ["/api/settings/company", "/api/settings/members"] : ["/api/settings/company"];
    Promise.all(urls.map(url => fetch(url, { cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })))
      .then(([companyData, memberData]) => { setCompany(companyData.company ?? empty); if (memberData) { setMembers(memberData.members ?? []); setAccessEvents(memberData.access_events ?? []); } })
      .catch(cause => setMessage(cause instanceof Error ? cause.message : "Nastavení se nepodařilo načíst."))
      .finally(() => setLoading(false));
  }, [currentRole]);

  const field = (key: keyof Company, value: string) => { setDirty(true); setCompany(current => ({ ...current, [key]: value })); };
  async function save() { setSaving(true); setMessage(""); try { const response = await fetch("/api/settings/company", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(company) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setCompany(data.company); setDirty(false); setMessage("Firemní údaje jsou uložené."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Údaje se nepodařilo uložit."); } finally { setSaving(false); } }
  async function addMember(event: React.FormEvent) { event.preventDefault(); setSaving(true); setMessage(""); try { const response = await fetch("/api/settings/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: newEmail, role: newRole }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await refreshMembers(); setNewEmail(""); setMessage("Přístup je přidaný. Uživatel si nyní vytvoří nový účet a potvrdí ověřovací e-mail."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Přístup se nepodařilo přidat."); } finally { setSaving(false); } }
  async function changeRole(member: Member, role: Role) { setSaving(true); setMessage(""); try { const response = await fetch("/api/settings/members", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: member.id, role }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await refreshMembers(); setMessage("Role uživatele je změněná."); } catch (cause) { await refreshMembers().catch(() => undefined); setMessage(cause instanceof Error ? cause.message : "Roli se nepodařilo změnit."); } finally { setSaving(false); } }
  async function removeMember(member: Member) { if (!await confirmAction({ title: `Odebrat přístup pro ${member.email}?`, description: "Přihlašovací účet bude smazán. Při opětovném přidání musí uživatel projít novou registrací a ověřit e-mail.", confirmLabel: "Odebrat přístup" })) return; setSaving(true); setMessage(""); try { const response = await fetch("/api/settings/members", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: member.id }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await refreshMembers(); setMessage("Přístup i přihlašovací účet byly smazány. Po opětovném přidání si uživatel vytvoří nový účet."); } catch (cause) { await refreshMembers().catch(() => undefined); setMessage(cause instanceof Error ? cause.message : "Přístup se nepodařilo odebrat."); } finally { setSaving(false); } }
  async function signOutEverywhere() { if (!await confirmAction({ title: "Odhlásit všechna zařízení?", description: "Všechny obnovovací relace budou zrušeny. Na každém zařízení bude nutné nové přihlášení a e-mailový kód.", confirmLabel: "Odhlásit všechna zařízení" })) return; setSaving(true); try { await signOutAllSessions(); window.location.replace("/login"); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Zařízení se nepodařilo odhlásit."); setSaving(false); } }

  return <AppFrame><header className="section-header"><div><p>SPRÁVA APLIKACE</p><h1>Nastavení</h1><span>{canAdminister ? "Firemní údaje a přístupy uživatelů." : "Firemní údaje pouze pro čtení."}</span></div>{canAdminister && <button className="btn primary" disabled={saving || loading} onClick={save}>{saving ? "Ukládám…" : "Uložit firemní údaje"}</button>}</header>
    {message && <p aria-live="polite" className={message.includes("uložené") || message.includes("přidaný") || message.includes("změněná") || message.includes("odebrán") ? "success-message" : "form-error"}>{message}</p>}
    <section className="page-panel session-security"><div><h2>Zabezpečení relací</h2><p>Pokud jste se přihlásili na ztraceném nebo cizím zařízení, ukončete všechny aktivní relace.</p></div><button type="button" className="btn danger" disabled={saving} onClick={signOutEverywhere}>Odhlásit všechna zařízení</button></section>
    <div className="settings-grid"><section className="page-panel company-settings"><header><div><h2>R. Hlavica s.r.o.</h2><p>Údaje použité v e-mailových šablonách a exportech.</p></div></header>{loading ? <p className="page-state">Načítám…</p> : <fieldset disabled={!canAdminister}><div className="settings-form"><label className="wide"><span>Obchodní název</span><input value={company.name} onChange={e => field("name", e.target.value)}/></label><label><span>IČO</span><input value={company.ico} onChange={e => field("ico", e.target.value)}/></label><label><span>DIČ</span><input value={company.dic} onChange={e => field("dic", e.target.value)}/></label><label className="wide"><span>Sídlo a fakturační adresa</span><input value={company.registered_address} onChange={e => field("registered_address", e.target.value)}/></label><label className="wide"><span>Provozovna a doručovací adresa</span><input value={company.operating_address} onChange={e => field("operating_address", e.target.value)}/></label><label><span>Datová schránka</span><input value={company.data_box_id} onChange={e => field("data_box_id", e.target.value)}/></label><label><span>Telefon</span><input value={company.phone} onChange={e => field("phone", e.target.value)}/></label><label className="wide"><span>Výchozí e-mail účetního oddělení</span><input type="email" value={company.email} onChange={e => field("email", e.target.value)}/></label><label><span>Bankovní účet CZK</span><input value={company.bank_account_czk} onChange={e => field("bank_account_czk", e.target.value)}/></label><label><span>Bankovní účet EUR</span><input value={company.bank_account_eur} onChange={e => field("bank_account_eur", e.target.value)}/></label></div></fieldset>}</section>
      {canAdminister && <MobileDisclosure label="Význam uživatelských rolí" className="settings-roles-disclosure"><aside className="settings-side"><section className="page-panel access-card"><h2>Význam rolí</h2><p>Role určují, kdo může pouze číst, pracovat s fakturami nebo měnit nastavení.</p><div className="role-list"><span><strong>Administrátor</strong><small>Firma, uživatelé i veškerá agenda</small></span><span><strong>Účetní</strong><small>Faktury, platby, upomínky a reporty</small></span><span><strong>Čtenář</strong><small>Přehled, reporty a faktury pouze pro čtení</small></span></div></section></aside></MobileDisclosure>}
    </div>
    {canAdminister && <><section className="page-panel members-settings"><header><div><h2>Přístupy účetního oddělení</h2><p>Povolené e-maily a jejich oprávnění. Aktivní znamená, že už se uživatel alespoň jednou přihlásil.</p></div></header>{loading ? <p className="page-state">Načítám přístupy…</p> : <><div className="members-list">{members.map(member => <article key={member.id}><span className={`member-state ${member.active ? "active" : "invited"}`}>{member.active ? "Aktivní" : "Připraven"}</span><div><strong>{member.email}{member.current ? " · váš účet" : ""}</strong><small>{roleNames[member.role]}</small></div><select disabled={saving} value={member.role} onChange={event => changeRole(member, event.target.value as Role)} aria-label={`Role uživatele ${member.email}`}><option value="admin">Administrátor</option><option value="accounting">Účetní</option><option value="viewer">Čtenář</option></select><button type="button" disabled={saving || member.current} onClick={() => removeMember(member)}>Odebrat</button></article>)}</div><form className="member-add" onSubmit={addMember}><label><span>E-mail nového uživatele</span><input type="email" required value={newEmail} onChange={event => setNewEmail(event.target.value)} placeholder="ucetni@hlavica.cz"/></label><label><span>Role</span><select value={newRole} onChange={event => setNewRole(event.target.value as Role)}><option value="accounting">Účetní</option><option value="viewer">Čtenář</option><option value="admin">Administrátor</option></select></label><button className="btn primary" disabled={saving}>+ Přidat přístup</button></form></>}</section>
    <MobileDisclosure label="Historie změn přístupů" className="access-history-disclosure"><section className="page-panel access-history"><header><div><h2>Historie změn přístupů</h2><p>Neměnná auditní stopa posledních administrátorských zásahů.</p></div></header><div className="access-history-list">{accessEvents.map(event => <article key={event.id}><i className={event.event_type}/><div><strong>{event.target_email}</strong><span>{accessAction(event)}</span></div><small>{formatAuditDate(event.created_at)}<br/>{event.actor_email}</small></article>)}{!accessEvents.length && <p className="page-state">Zatím nebyla zaznamenána žádná změna přístupů.</p>}</div></section></MobileDisclosure></>}
  </AppFrame>;
}
