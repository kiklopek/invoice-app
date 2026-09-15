-- Cover every GPC foreign key used during archive cleanup, allocation commits,
-- and audit lookups. Kept as a separate migration from the base GPC migration
-- (20260915095449) so the two can be reviewed and deployed independently.
create index if not exists bank_statement_imports_created_by_idx
  on public.bank_statement_imports(created_by);
create index if not exists bank_statement_imports_committed_by_idx
  on public.bank_statement_imports(committed_by);

create index if not exists bank_statement_entries_org_import_idx
  on public.bank_statement_entries(organization_id, import_id);
create index if not exists bank_statement_entries_bank_payment_id_idx
  on public.bank_statement_entries(bank_payment_id);

create index if not exists bank_payment_allocations_created_by_idx
  on public.bank_payment_allocations(created_by);
create index if not exists bank_payment_allocations_org_entry_idx
  on public.bank_payment_allocations(organization_id, statement_entry_id);
create index if not exists bank_payment_allocations_invoice_id_idx
  on public.bank_payment_allocations(invoice_id);
create index if not exists bank_payment_allocations_org_payment_idx
  on public.bank_payment_allocations(organization_id, bank_payment_id);

create index if not exists counterparty_payment_accounts_confirmed_by_idx
  on public.counterparty_payment_accounts(confirmed_by);
