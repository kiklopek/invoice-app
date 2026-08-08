create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

alter function public.is_org_member(uuid) set schema private;
alter function public.has_org_role(uuid, text[]) set schema private;

revoke all on function private.is_org_member(uuid) from public, anon, authenticated;
revoke all on function private.has_org_role(uuid, text[]) from public, anon, authenticated;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, text[]) to authenticated, service_role;

alter policy "members can view organization" on public.organizations to authenticated;
alter policy "members can view memberships" on public.organization_members to authenticated;
alter policy "members can view organization member events" on public.organization_member_events to authenticated;
alter policy "members can view policies" on public.reminder_policies to authenticated;
alter policy "members can view templates" on public.email_templates to authenticated;
alter policy "members can view invoices" on public.invoices to authenticated;
alter policy "members can view invoice events" on public.invoice_events to authenticated;
alter policy "members can view invoice uploads" on public.invoice_uploads to authenticated;
alter policy "members can view reminder log" on public.reminder_log to authenticated;
alter policy "members can view reminder automation runs" on public.reminder_automation_runs to authenticated;
alter policy "members can view reminder settings events" on public.reminder_settings_events to authenticated;
alter policy "members can view email suppressions" on public.email_suppressions to authenticated;
alter policy "members can view bank payments" on public.bank_payments to authenticated;

alter policy "accounting can create invoices" on public.invoices to authenticated
  with check (
    private.has_org_role(organization_id, array['accounting', 'admin'])
    and created_by = (select auth.uid())
  );

alter policy "accounting can update invoices" on public.invoices to authenticated
  using (private.has_org_role(organization_id, array['accounting', 'admin']))
  with check (private.has_org_role(organization_id, array['accounting', 'admin']));
