alter table public.invoice_uploads
  add column if not exists ocr_field_sources jsonb not null default '{}'::jsonb
  check (jsonb_typeof(ocr_field_sources) = 'object');

comment on column public.invoice_uploads.ocr_field_sources is
  'Bounded provenance for invoice fields extracted from the uploaded document: page, line, original text, method, confidence and normalized bounds.';
