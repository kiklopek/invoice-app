-- Public registry data cached server-side so OCR does not depend on ARES
-- availability for every import. No browser role can read or mutate it.
create table public.company_registry_cache (
  ico text primary key check (ico ~ '^\d{8}$'),
  legal_name text,
  lookup_status text not null check (lookup_status in ('found', 'not_found')),
  fetched_at timestamptz not null default now()
);

alter table public.company_registry_cache enable row level security;
revoke all on table public.company_registry_cache from anon, authenticated;
grant select, insert, update, delete on table public.company_registry_cache to service_role;

-- One immutable review snapshot per imported invoice. Values are restricted
-- to the same invoice fields already stored by the application; raw OCR text
-- and an extra copy of the document are deliberately not retained.
create table public.invoice_ocr_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  upload_id uuid unique references public.invoice_uploads(id) on delete set null,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  proposed_values jsonb not null check (jsonb_typeof(proposed_values) = 'object'),
  final_values jsonb not null check (jsonb_typeof(final_values) = 'object'),
  corrected_fields text[] not null default '{}',
  field_decisions jsonb not null default '{}'::jsonb check (jsonb_typeof(field_decisions) = 'object'),
  vocabulary_version text not null,
  ocr_model text not null,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, invoice_id)
);

create index invoice_ocr_reviews_org_created_idx on public.invoice_ocr_reviews(organization_id, created_at desc);
create index invoice_ocr_reviews_invoice_idx on public.invoice_ocr_reviews(invoice_id);
create index invoice_ocr_reviews_reviewed_by_idx on public.invoice_ocr_reviews(reviewed_by);

alter table public.invoice_ocr_reviews enable row level security;
revoke all on table public.invoice_ocr_reviews from anon, authenticated;
grant select, insert, update, delete on table public.invoice_ocr_reviews to service_role;

-- Unknown labels are stored without the value that followed them. Repeated
-- labels can be reviewed across documents, but never mutate the vocabulary
-- automatically.
create table public.invoice_ocr_keyword_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  upload_id uuid not null references public.invoice_uploads(id) on delete cascade,
  normalized_label text not null check (length(normalized_label) between 2 and 80),
  example_label text not null check (length(example_label) between 2 and 80),
  vocabulary_version text not null,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  unique (organization_id, upload_id, normalized_label)
);

create index invoice_ocr_keyword_suggestions_org_label_idx
  on public.invoice_ocr_keyword_suggestions(organization_id, normalized_label, created_at desc);
create index invoice_ocr_keyword_suggestions_upload_idx
  on public.invoice_ocr_keyword_suggestions(upload_id);

alter table public.invoice_ocr_keyword_suggestions enable row level security;
revoke all on table public.invoice_ocr_keyword_suggestions from anon, authenticated;
grant select, insert, update, delete on table public.invoice_ocr_keyword_suggestions to service_role;

create view public.invoice_ocr_field_accuracy with (security_invoker = true) as
select review.organization_id,
  review.vocabulary_version,
  decision.field_name,
  count(*)::bigint as reviewed_count,
  count(*) filter (where not (decision.field_name = any(review.corrected_fields)))::bigint as accepted_count,
  round(100.0 * count(*) filter (where not (decision.field_name = any(review.corrected_fields))) / nullif(count(*), 0), 2) as accuracy_percent
from public.invoice_ocr_reviews review
cross join lateral jsonb_object_keys(review.field_decisions) decision(field_name)
group by review.organization_id, review.vocabulary_version, decision.field_name;

revoke all on table public.invoice_ocr_field_accuracy from anon, authenticated;
grant select on table public.invoice_ocr_field_accuracy to service_role;

alter table public.invoice_uploads
  add column ocr_proposed_values jsonb not null default '{}'::jsonb check (jsonb_typeof(ocr_proposed_values) = 'object'),
  add column ocr_field_decisions jsonb not null default '{}'::jsonb check (jsonb_typeof(ocr_field_decisions) = 'object'),
  add column ocr_vocabulary_version text;
