alter table public.organizations
  add column if not exists ocr_hourly_limit integer default 20
  check (ocr_hourly_limit is null or ocr_hourly_limit between 1 and 10000);

comment on column public.organizations.ocr_hourly_limit is
  'Maximum OCR attempts per user in a rolling hour. NULL disables the usage quota; technical safety limits still apply.';

update public.organizations
set ocr_hourly_limit = null
where regexp_replace(coalesce(ico, ''), '\D', '', 'g') = '26296039';
