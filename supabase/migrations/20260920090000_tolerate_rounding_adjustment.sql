-- A multi-line invoice rounds each line item to 2 decimals before summing,
-- so its printed total routinely differs from base*rate/100 by a few haléře
-- with no real error anywhere -- this forced the same mandatory "explain and
-- confirm the difference" step for a 0.04 Kč rounding remainder as for a
-- genuinely wrong amount. Mirrors AMOUNT_ADJUSTMENT_TOLERANCE in vat.ts;
-- keep both in sync if this ever changes. Every difference past this
-- threshold still requires explicit confirmation exactly as before -- this
-- narrows what counts as "a difference", it doesn't touch what happens once
-- something counts as one.
create or replace function public.validate_invoice_money_evidence()
returns trigger language plpgsql set search_path=public as $$
declare difference numeric; initial_paid numeric; snapshot jsonb;
begin
  if tg_op='UPDATE' then
    if coalesce((new.money_evidence->>'initial_paid')::numeric,0)
       <>coalesce((old.money_evidence->>'initial_paid')::numeric,0) then
      raise exception 'initial_payment_requires_ledger_correction';
    end if;
    if old.money_evidence is not null and (
       new.money_evidence is null or new.money_evidence->'original_total' is distinct from old.money_evidence->'original_total') then
      raise exception 'original_amount_is_immutable';
    end if;
    if new.amount=old.amount and new.amount_without_vat=old.amount_without_vat
       and new.vat_rate=old.vat_rate and new.money_evidence is not distinct from old.money_evidence then return new; end if;
    if new.amount<>old.amount and new.money_evidence is not null then
      new.money_evidence:=jsonb_set(new.money_evidence,'{total_source}','"manual"');
    end if;
  elsif new.file_url is not null then
    -- The saved OCR result, not a browser-supplied original_total, is the evidence.
    select ocr_money_snapshot into snapshot from public.invoice_uploads
      where organization_id=new.organization_id and path=new.file_url;
    if snapshot is not null then
      new.money_evidence:=coalesce(new.money_evidence,snapshot)||jsonb_build_object(
        'original_total',snapshot->'original_total',
        'total_source',case when new.amount=(snapshot->>'original_total')::numeric
          then snapshot->>'total_source' else 'manual' end);
    end if;
  end if;
  difference:=new.amount-round(new.amount_without_vat*(100+new.vat_rate)/100,2);
  if abs(difference)>0.05 and (new.money_evidence is null
    or coalesce((new.money_evidence->>'adjustment_confirmed')::boolean,false)=false
    or nullif(trim(new.money_evidence->>'adjustment_reason'),'') is null) then
    raise exception 'unconfirmed_amount_adjustment';
  end if;
  if new.money_evidence is not null then
    if jsonb_typeof(new.money_evidence)<>'object'
       or not (new.money_evidence ?& array['original_total','total_source','initial_paid']) then
      raise exception 'invalid_money_evidence';
    end if;
    new.money_evidence:=jsonb_set(new.money_evidence,'{adjustment}',to_jsonb(difference));
    initial_paid:=round((new.money_evidence->>'initial_paid')::numeric,2);
    new.money_evidence:=jsonb_set(new.money_evidence,'{initial_paid}',to_jsonb(initial_paid));
    if initial_paid>0 and not coalesce((new.money_evidence->>'initial_paid_confirmed')::boolean,false) then
      raise exception 'unconfirmed_initial_payment';
    end if;
  end if;
  return new;
end $$;
