create index counterparty_reminder_preferences_invoice_idx
  on public.counterparty_reminder_preferences (organization_id, last_invoice_id);

create index counterparty_reminder_preferences_updated_by_idx
  on public.counterparty_reminder_preferences (updated_by);
