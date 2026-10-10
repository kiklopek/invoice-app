-- Automatické zaúčtování po firmách.
--
-- * organizations.auto_booking: 'vs' (výchozí pro nové firmy: automaticky jen
--   při shodě VS / čísla faktury a přesné částky), 'vs_and_name' (dosavadní
--   chování -- i potvrzený účet plátce a jméno plátce s částkou; dostanou ho
--   všechny stávající firmy, tj. R. Hlavica), 'off'. Mění ho jen migrace nebo
--   provozovatel (service_role), ne přihlášený uživatel.
-- * Výpis z jiného než firemního účtu (account_mismatch bez potvrzení) znovu
--   blokuje automatiku. Výjimka z 20260918200000_mismatch_stops_blocking_automation.sql
--   vznikla kvůli chybě čtení permutovaného účtu KB, která je opravená
--   (ověřeno na produkčních importech: hlavní účet R. Hlavica už sedí).
--
-- * Čísla faktur s oddělovači („FV-2026/001“) se najdou ve zprávě i jako VS
--   (reconcile_bank_statement i trigger private.guard_automatic_payment).
-- * Oprava: pojistka „znovu ověř důkaz před automatickým zaúčtováním“ se u
--   platby bez VS tiše přeskočila (NULL v `not (...)`), takže rozhodla jen
--   webová vrstva. Teď je výsledek coalesce(..., false).
--
-- Aktuální tělo reconcile_bank_statement: 20260930195017_gpc_unrelated_rows.sql.
-- Globální vypínač PAYMENT_RECONCILIATION_MODE zůstává nad tímhle.

alter table public.organizations
  add column if not exists auto_booking text not null default 'vs'
    check (auto_booking in ('off','vs','vs_and_name'));

-- Stávající firmy si ponechají dosavadní chování.
update public.organizations set auto_booking='vs_and_name';

revoke update (auto_booking) on public.organizations from anon, authenticated;

-- Číslo faktury při párování (stejná pravidla jako src/lib/invoice-number.ts
-- a referencesInvoiceNumber ve statement-assignment.ts). Dřív se ve zprávě
-- hledalo jen číslo bez oddělovačů a jako VS jen čistě číselné číslo, takže
-- faktury firem s čísly „FV-2026/001“ se nikdy nenašly.
create or replace function private.compact_invoice_number(value text)
returns text language sql immutable set search_path = pg_catalog
as $$ select upper(regexp_replace(coalesce(value,''), '[^0-9A-Za-z]', '', 'g')) $$;

create or replace function private.numeric_invoice_number(value text)
returns text language sql immutable set search_path = pg_catalog
as $$ select case when btrim(coalesce(value,'')) ~ '^[0-9]+([-/. ][0-9]+)*$'
  then regexp_replace(btrim(value), '[^0-9]', '', 'g') else '' end $$;

create or replace function private.message_references_invoice(note text, invoice_number text)
returns boolean language sql immutable set search_path = pg_catalog, public
as $$
  select length(private.compact_invoice_number(invoice_number)) >= 4
    and private.compact_invoice_number(invoice_number) ~ '[0-9]'
    and note is not null
    and exists (
      select 1 from regexp_split_to_table(note, '[[:space:],;:()"''„“\[\]]+') token
      where private.compact_invoice_number(token) = private.compact_invoice_number(invoice_number)
    )
$$;
revoke all on function private.compact_invoice_number(text) from public, anon, authenticated;
revoke all on function private.numeric_invoice_number(text) from public, anon, authenticated;
revoke all on function private.message_references_invoice(text, text) from public, anon, authenticated;

create or replace function public.reconcile_bank_statement(
  target_org uuid, actor_user uuid, target_import uuid, expected_revision integer,
  automatic_only boolean default false, acknowledge_account_mismatch boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.bank_statement_imports%rowtype; e public.bank_statement_entries%rowtype;
  a record; inv public.invoices%rowtype; total numeric; n integer; partial boolean;
  payment_id uuid; sole_invoice uuid; failures jsonb := '[]'; done integer:=0; matched integer:=0;
  remaining integer; error_code text; allocated uuid[]; proposed uuid[]; skipped integer:=0;
  booking_mode text;
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user and role in ('accounting','admin')) then raise exception 'insufficient_payment_import_permission'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text,0));
  select * into s from public.bank_statement_imports where id=target_import and organization_id=target_org for update;
  if not found then raise exception 'statement_import_not_found'; end if;
  if s.status='committed' then return jsonb_build_object('status','committed','revision',s.revision,'imported',0,'matched',0,'errors','[]'::jsonb,'idempotent',true); end if;
  if s.revision<>expected_revision then raise exception 'revision_conflict'; end if;
  if s.status<>'review' then raise exception 'statement_import_not_committable'; end if;
  if s.account_mismatch and not s.account_mismatch_acknowledged
     and not automatic_only and not acknowledge_account_mismatch then raise exception 'account_mismatch_acknowledgement_required'; end if;
  if automatic_only and s.automation_mode<>'automatic' then
    return jsonb_build_object('status','shadow','revision',s.revision,'imported',0,'matched',0,'errors','[]'::jsonb);
  end if;
  -- Automatika po firmách: 'off' nic bez člověka. A výpis z jiného než
  -- firemního účtu automaticky nic nezaúčtuje, dokud ho člověk nepotvrdí.
  -- (Výjimka z 20260918200000 vznikla, protože hlavička KB „nikdy neseděla“ --
  -- to byla chyba čtení permutovaného účtu, dnes opravená. U jiné firmy by
  -- výjimka zaúčtovala cizí výpis proti jejím fakturám.)
  select coalesce(o.auto_booking,'vs') into booking_mode from public.organizations o where o.id=target_org;
  if automatic_only and (booking_mode='off' or (s.account_mismatch and not s.account_mismatch_acknowledged)) then
    return jsonb_build_object('status','held','revision',s.revision,'imported',0,'matched',0,'errors','[]'::jsonb);
  end if;
  for e in select * from public.bank_statement_entries where import_id=target_import and disposition='accepted'
    and bank_payment_id is null and unrelated_at is null
    and (not automatic_only or (proposal_confidence='safe' and matching_version=private.matching_engine_version()))
    order by line_number limit 100
  loop
    begin
      if exists(select 1 from public.bank_payments where organization_id=target_org and external_id=e.external_id) then
        raise exception 'possible_duplicate';
      end if;
      select coalesce(sum(amount),0),count(*),coalesce(bool_or(is_manual_partial),false),
        (array_agg(invoice_id order by invoice_id))[1] into total,n,partial,sole_invoice
        from public.bank_payment_allocations where statement_entry_id=e.id and not is_committed;
      -- One payment may now settle SEVERAL invoices unattended, so the old
      -- "exactly one allocation" rule is replaced by a stricter equality: the
      -- set of uncommitted allocations must be EXACTLY the set the matcher
      -- proposed -- no invoice added, none dropped, none swapped -- and the
      -- allocated total must be the whole payment. A subset or superset means
      -- the ledger moved under the proposal, which is the case this refuses.
      select coalesce(array_agg(invoice_id order by invoice_id),'{}') into allocated
        from public.bank_payment_allocations where statement_entry_id=e.id and not is_committed;
      select coalesce(array_agg(x order by x),'{}') into proposed
        from unnest(e.proposed_invoice_ids) x;
      if automatic_only and (n<1 or total<>e.amount or allocated is distinct from proposed) then raise exception 'proposal_changed'; end if;
      if total>e.amount or (n>0 and total<>e.amount and not partial) then raise exception 'invalid_allocation_totals'; end if;
      for a in select * from public.bank_payment_allocations where statement_entry_id=e.id and not is_committed order by invoice_id loop
        select * into inv from public.invoices where id=a.invoice_id and organization_id=target_org for update;
        if not found or inv.status not in ('pending','overdue') or inv.currency<>e.currency then raise exception 'invalid_allocation_target'; end if;
        if a.amount>inv.amount-inv.paid_amount then raise exception 'invoice_balance_changed'; end if;
        -- Unattended commits still demand a verifiable identity and the exact
        -- remaining balance -- what widens here is only WHICH identity counts.
        -- A counterparty account a human has already confirmed for this
        -- counterparty is evidence of the same kind as a matching VS, and it
        -- is the only identity a payment without a usable VS can ever offer.
        -- Re-derive the evidence here rather than trusting the proposal. The
        -- matcher that produced it runs in the web tier against a snapshot of
        -- the ledger; this runs inside the booking transaction against the
        -- locked rows, so it is the check that actually protects the money.
        -- coalesce: bez VS dávají porovnání NULL a `not (NULL or …)` je NULL,
        -- což IF bere jako nepravdu -- pojistka by se tiše přeskočila.
        if automatic_only and (a.amount<>inv.amount-inv.paid_amount or not coalesce(
          -- The payment's symbol is the invoice's own symbol...
          nullif(ltrim(regexp_replace(coalesce(inv.variable_symbol,''),'\s','','g'),'0'),'')=nullif(ltrim(e.variable_symbol,'0'),'')
          -- ...or its number, for invoices printed without a symbol at all.
          -- Separators allowed: "2026/001" is paid with VS 2026001.
          or (nullif(trim(inv.variable_symbol),'') is null and private.numeric_invoice_number(inv.invoice_number)<>''
            and nullif(ltrim(private.numeric_invoice_number(inv.invoice_number),'0'),'')=nullif(ltrim(e.variable_symbol,'0'),''))
          -- ...or the payer wrote the invoice number in the message, as a whole
          -- token: without the boundaries, invoice 1234 matches inside document
          -- number 091500001234567 and books a stranger's payment.
          -- Compared without separators ("FV-2026/001" = "FV2026001").
          or private.message_references_invoice(e.note, inv.invoice_number)
          -- ...or the payer's account is a confirmed identity for this customer
          -- AND identifies only this one customer. An account confirmed for two
          -- customers names neither, so it cannot carry an unattended booking.
          -- Never true for an account this session could not verify against
          -- its own checksum -- an unverifiable number is not evidence of
          -- anything, no matter what it happens to collide with.
          or (booking_mode='vs_and_name' and coalesce(e.counterparty_account_verified,true)
            and exists(select 1 from public.counterparty_payment_accounts c
                where c.organization_id=target_org and c.account_number=e.counterparty_account
                  and c.counterparty_ico=nullif(trim(inv.counterparty_ico),''))
            and (select count(distinct c2.counterparty_ico) from public.counterparty_payment_accounts c2
                where c2.organization_id=target_org and c2.account_number=e.counterparty_account)=1)
          -- ...or the payer's NAME agrees with the customer and the payment is
          -- not older than the invoice. Only for companies with
          -- auto_booking='vs_and_name' (R. Hlavica, at the owner's decision);
          -- the confirmed-account rule above likewise. Both identify the
          -- PAYER, never the invoice, so they rest entirely on the amount
          -- belonging to just one open invoice of theirs -- which the
          -- caller's uniqueness pass, not this check, is what establishes.
          or (booking_mode='vs_and_name' and private.names_match(e.counterparty_name,inv.counterparty_name)
            and (e.booked_on is null or inv.issue_date is null or e.booked_on>=inv.issue_date))
        , false)) then raise exception 'proposal_changed'; end if;
      end loop;
      insert into public.bank_payments(organization_id,invoice_id,external_id,booked_on,amount,currency,
        variable_symbol,counterparty_name,counterparty_account,note,match_reason,match_status,source,imported_by,matched_at)
      values(target_org,case when n=1 and total=e.amount then sole_invoice else null end,e.external_id,e.booked_on,e.amount,e.currency,
        e.variable_symbol,e.counterparty_name,e.counterparty_account,e.note,
        case when automatic_only then e.proposal_reason else null end,
        case when n=1 and total=e.amount then 'matched' when n>1 and total=e.amount then 'split' when n>0 then 'ambiguous' else 'unmatched' end,
        'bank_import',actor_user,case when n>0 then now() else null end) returning id into payment_id;
      for a in select * from public.bank_payment_allocations where statement_entry_id=e.id and not is_committed order by invoice_id loop
        update public.invoices set paid_amount=paid_amount+a.amount,
          status=case when paid_amount+a.amount=amount then 'paid' when due_date<(now() at time zone 'Europe/Prague')::date then 'overdue' else 'pending' end,
          paid_at=case when paid_amount+a.amount=amount then (e.booked_on+time '12:00') at time zone 'Europe/Prague' else null end,
          next_reminder_at=case when paid_amount+a.amount=amount then null else next_reminder_at end,
          updated_by=actor_user,updated_at=now() where id=a.invoice_id;
      end loop;
      update public.bank_payment_allocations set bank_payment_id=payment_id,is_committed=true,committed_at=now()
        where statement_entry_id=e.id and not is_committed;
      update public.bank_statement_entries set bank_payment_id=payment_id,processed_at=now(),processing_error=null where id=e.id;
      -- Learn the payer's account identity, but only from an allocation that
      -- paid exactly one invoice in full: that is the only case where the
      -- account provably belongs to that one counterparty. A split or partial
      -- payment leaves the attribution ambiguous, and a wrong identity learned
      -- here would quietly steer future automatic matches. An unverified
      -- account number (failed checksum on decode) is never learned either --
      -- learning a wrong-but-plausible-looking account would quietly poison
      -- every future automatic match against it.
      if n=1 and total=e.amount and coalesce(e.counterparty_account_verified,true) and private.is_learnable_account(e.counterparty_account) then
        insert into public.counterparty_payment_accounts(organization_id,counterparty_ico,account_number,confirmed_by)
          select distinct target_org,i.counterparty_ico,e.counterparty_account,actor_user
          from public.bank_payment_allocations x join public.invoices i on i.id=x.invoice_id
          where x.statement_entry_id=e.id and nullif(trim(i.counterparty_ico),'') is not null
          on conflict(organization_id,counterparty_ico,account_number) do update set last_used_at=now();
      end if;
      done:=done+1; if n>0 then matched:=matched+1; end if;
    exception when others then
      error_code:=case when sqlerrm in ('possible_duplicate','proposal_changed','invalid_allocation_totals','invalid_allocation_target','invoice_balance_changed') then sqlerrm else 'entry_commit_failed' end;
      update public.bank_statement_entries set processing_error=error_code,proposal_confidence='review' where id=e.id;
      failures:=failures||jsonb_build_array(jsonb_build_object('entry_id',e.id,'line_number',e.line_number,'code',error_code));
    end;
  end loop;
  -- Rows the reviewer marked "Nesouvisí s fakturami" were never picked up by
  -- the loop above. Count them for the result, and when a PERSON commits,
  -- stamp them as handled by this commit. processing_error is left alone on
  -- purpose: a duplicate warning on such a row stays visible.
  select count(*) into skipped from public.bank_statement_entries
    where import_id=target_import and disposition='accepted' and bank_payment_id is null and unrelated_at is not null;
  if not automatic_only then
    update public.bank_statement_entries set processed_at=now()
      where import_id=target_import and disposition='accepted' and bank_payment_id is null
        and unrelated_at is not null and processed_at is null;
  end if;
  select count(*) into remaining from public.bank_statement_entries where import_id=target_import and disposition='accepted' and bank_payment_id is null
    and unrelated_at is null;
  update public.bank_statement_imports set revision=revision+1,status=case when remaining=0 then 'committed' else 'review' end,
    commit_requested=not automatic_only and remaining>0 and jsonb_array_length(failures)=0,
    updated_at=now(),committed_at=case when remaining=0 then now() else null end,
    committed_by=case when remaining=0 then actor_user else null end,
    account_mismatch_acknowledged=account_mismatch_acknowledged or acknowledge_account_mismatch
    where id=target_import;
  return jsonb_build_object('status',case when remaining=0 then 'committed' else 'review' end,'revision',s.revision+1,
    'imported',done,'matched',matched,'remaining',remaining,'unrelated',skipped,'errors',failures,'idempotent',false);
end $$;

-- Trigger, který při automatickém zaúčtování znovu seřadí kandidáty, musí
-- číslo faktury číst stejně (jinak by shodu „FV2026001“ ↔ „FV-2026/001“
-- odmítl). Aktuální tělo: 20260919133000_reconciliation_integrity_guards.sql;
-- mění se jen čtení čísla faktury, trigger zůstává.
create or replace function private.guard_automatic_payment() returns trigger
language plpgsql security definer set search_path=public as $$
declare selected_invoice public.invoices%rowtype; candidate record; best integer:=99;
  winners uuid[]:='{}'; rank integer; account_icos text[]; symbol text; targets uuid[];
begin
  if new.match_reason is null then return new; end if; -- explicit human decisions
  -- A split payment (one payment across several invoices) has no single
  -- invoice_id to re-check here -- it books with invoice_id null and its own
  -- combination path (name_combination_auto_match.sql) already re-validates
  -- every candidate invoice inline, in the same transaction, before this row
  -- is even inserted. Written before that path existed, this guard assumed
  -- every automatic bank_payments row named exactly one invoice; left as-is
  -- it would raise proposal_changed on every automatic split payment ever
  -- since NULL never matches an id.
  if new.invoice_id is null then return new; end if;
  select * into selected_invoice from public.invoices
    where id=new.invoice_id and organization_id=new.organization_id for update;
  if not found then raise exception 'proposal_changed'; end if;
  select array_agg(distinct counterparty_ico) into account_icos from public.counterparty_payment_accounts
    where organization_id=new.organization_id and account_number=new.counterparty_account;
  if cardinality(account_icos)>0 and not coalesce(selected_invoice.counterparty_ico=any(account_icos),false) then
    raise exception 'proposal_changed';
  end if;
  symbol:=nullif(ltrim(regexp_replace(coalesce(new.variable_symbol,''),'\s','','g'),'0'),'');
  -- A known explicit reference must not be replaced by a coincidental amount.
  select array_agg(id) into targets from public.invoices i
  where i.organization_id=new.organization_id and i.currency=new.currency and i.status<>'cancelled'
    and (nullif(ltrim(regexp_replace(coalesce(nullif(trim(i.variable_symbol),''),
        nullif(private.numeric_invoice_number(i.invoice_number),''),''),'\s','','g'),'0'),'')=symbol
      or private.message_references_invoice(new.note, i.invoice_number));
  if cardinality(targets)>0 and (cardinality(targets)<>1 or targets[1]<>new.invoice_id) then
    raise exception 'proposal_changed';
  end if;
  for candidate in select * from public.invoices i
    where i.organization_id=new.organization_id and i.currency=new.currency
      and i.status in ('pending','overdue') and i.amount-i.paid_amount=new.amount
    order by id for update
  loop
    rank:=99;
    if nullif(ltrim(regexp_replace(coalesce(nullif(trim(candidate.variable_symbol),''),
        nullif(private.numeric_invoice_number(candidate.invoice_number),''),''),'\s','','g'),'0'),'')=symbol then rank:=1;
    elsif private.message_references_invoice(new.note, candidate.invoice_number) then rank:=2;
    elsif new.booked_on>=candidate.issue_date then
      if cardinality(account_icos)=1 and candidate.counterparty_ico=account_icos[1] then rank:=3;
      elsif private.names_match(new.counterparty_name,candidate.counterparty_name) then rank:=4;
      end if;
    end if;
    if rank<best then best:=rank; winners:=array[candidate.id];
    elsif rank=best then winners:=array_append(winners,candidate.id); end if;
  end loop;
  if best=99 or cardinality(winners)<>1 or winners[1]<>new.invoice_id then raise exception 'proposal_changed'; end if;
  return new;
end $$;
