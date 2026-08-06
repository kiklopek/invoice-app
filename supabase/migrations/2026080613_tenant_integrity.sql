-- Defense in depth: organization_id must agree across every invoice-owned relation.
-- Existing single-column foreign keys remain responsible for their ON DELETE actions;
-- these composite keys prevent accidental cross-organization links.
alter table reminder_policies
  add constraint reminder_policies_org_id_key unique (organization_id, id);
alter table invoices
  add constraint invoices_org_id_key unique (organization_id, id);

alter table invoices
  add constraint invoices_policy_same_org_fkey
  foreign key (organization_id, reminder_policy_id)
  references reminder_policies (organization_id, id) not valid;
alter table invoice_events
  add constraint invoice_events_invoice_same_org_fkey
  foreign key (organization_id, invoice_id)
  references invoices (organization_id, id) not valid;
alter table invoice_uploads
  add constraint invoice_uploads_invoice_same_org_fkey
  foreign key (organization_id, invoice_id)
  references invoices (organization_id, id) not valid;
alter table reminder_log
  add constraint reminder_log_invoice_same_org_fkey
  foreign key (organization_id, invoice_id)
  references invoices (organization_id, id) not valid;
alter table bank_payments
  add constraint bank_payments_invoice_same_org_fkey
  foreign key (organization_id, invoice_id)
  references invoices (organization_id, id) not valid;

-- A paid timestamp and an active reminder schedule must always agree with invoice status.
alter table invoices
  add constraint invoices_paid_state_check
  check ((status = 'paid') = (paid_at is not null)) not valid;
alter table invoices
  add constraint invoices_closed_schedule_check
  check (status in ('pending', 'overdue') or next_reminder_at is null) not valid;

-- Only a completed send may carry sent/provider timestamps. Failed, skipped and leased
-- rows remain unsent and can therefore be retried without ambiguous database state.
alter table reminder_log
  add constraint reminder_log_sent_state_check
  check ((status = 'sent') = (sent_at is not null)) not valid;
alter table reminder_log
  add constraint reminder_log_provider_state_check
  check (provider_message_id is null or status = 'sent') not valid;

alter table invoices validate constraint invoices_policy_same_org_fkey;
alter table invoice_events validate constraint invoice_events_invoice_same_org_fkey;
alter table invoice_uploads validate constraint invoice_uploads_invoice_same_org_fkey;
alter table reminder_log validate constraint reminder_log_invoice_same_org_fkey;
alter table bank_payments validate constraint bank_payments_invoice_same_org_fkey;
alter table invoices validate constraint invoices_paid_state_check;
alter table invoices validate constraint invoices_closed_schedule_check;
alter table reminder_log validate constraint reminder_log_sent_state_check;
alter table reminder_log validate constraint reminder_log_provider_state_check;
