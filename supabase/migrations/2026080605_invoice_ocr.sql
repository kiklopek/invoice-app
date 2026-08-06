-- Bezpečný stav a nákladový limit multimodálního OCR.
alter table invoice_uploads
  add column if not exists ocr_status text not null default 'idle' check (ocr_status in ('idle', 'processing', 'succeeded', 'failed')),
  add column if not exists ocr_attempt_count integer not null default 0 check (ocr_attempt_count between 0 and 3),
  add column if not exists ocr_started_at timestamptz,
  add column if not exists ocr_completed_at timestamptz,
  add column if not exists ocr_error text,
  add column if not exists ocr_model text,
  add column if not exists ocr_provider_response_id text;

create or replace function claim_invoice_ocr(target_upload_id uuid, target_user_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare claimed_id uuid;
begin
  update invoice_uploads set
    ocr_status = 'processing',
    ocr_attempt_count = ocr_attempt_count + 1,
    ocr_started_at = now(),
    ocr_completed_at = null,
    ocr_error = null
  where id = target_upload_id
    and created_by = target_user_id
    and status = 'verified'
    and expires_at > now()
    and ocr_attempt_count < 3
    and (ocr_status in ('idle', 'failed') or (ocr_status = 'processing' and ocr_started_at < now() - interval '5 minutes'))
  returning id into claimed_id;
  return claimed_id is not null;
end;
$$;

revoke all on function claim_invoice_ocr(uuid, uuid) from public, anon, authenticated;
grant execute on function claim_invoice_ocr(uuid, uuid) to service_role;
