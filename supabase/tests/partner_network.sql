\set ON_ERROR_STOP on
-- Splatno Síť: propojení firem, vzájemná bilance, izolace dat mezi firmami,
-- rozpory bez změny peněz, pozvánky a práva.
begin;
do $$
declare
  admin_a uuid := gen_random_uuid(); acc_a uuid := gen_random_uuid(); viewer_a uuid := gen_random_uuid();
  admin_b uuid := gen_random_uuid(); acc_b uuid := gen_random_uuid();
  admin_c uuid := gen_random_uuid();
  admin_e1 uuid := gen_random_uuid(); admin_e2 uuid := gen_random_uuid();
  admin_f uuid := gen_random_uuid(); admin_g uuid := gen_random_uuid();
  org_a uuid := gen_random_uuid(); org_b uuid := gen_random_uuid(); org_c uuid := gen_random_uuid();
  org_e1 uuid := gen_random_uuid(); org_e2 uuid := gen_random_uuid();
  org_f uuid := gen_random_uuid(); org_g uuid := gen_random_uuid();
  inv_open uuid; inv_paid_history uuid; inv_cancelled uuid; inv_new uuid; inv_b_to_a uuid; inv_a_to_c uuid;
  conn uuid; conn_bc uuid; result jsonb; failed text; flag_id uuid; claim_id uuid;
  token_one text := repeat('a', 64); token_two text := repeat('b', 64); token_bad text := repeat('c', 64);
  before_inv invoices%rowtype; after_inv invoices%rowtype;
begin
  insert into auth.users(id, email) values
    (admin_a, 'admin@alfa.cz'), (acc_a, 'ucetni@alfa.cz'), (viewer_a, 'ctenar@alfa.cz'),
    (admin_b, 'jana@beta.cz'), (acc_b, 'ucetni@beta.cz'), (admin_c, 'admin@gama.cz'),
    (admin_e1, 'e1@duplicita.cz'), (admin_e2, 'e2@duplicita.cz'), (admin_f, 'f@nova.cz'), (admin_g, 'g@jina.cz');
  insert into organizations(id, name, ico, created_at) values
    (org_a, 'Alfa s.r.o.', '12345601', now() - interval '1 year'),
    (org_b, 'Beta a.s.', '12345610', now() - interval '1 year'),
    (org_c, 'Gama s.r.o.', '12345628', now() - interval '1 year'),
    (org_e1, 'Duplicita 1', '12345636', now() - interval '1 year'),
    (org_e2, 'Duplicita 2', '12345636', now() - interval '1 year');
  insert into organization_members(organization_id, user_id, email, role) values
    (org_a, admin_a, 'admin@alfa.cz', 'admin'), (org_a, acc_a, 'ucetni@alfa.cz', 'accounting'),
    (org_a, viewer_a, 'ctenar@alfa.cz', 'viewer'),
    (org_b, admin_b, 'jana@beta.cz', 'admin'), (org_b, acc_b, 'ucetni@beta.cz', 'accounting'),
    (org_c, admin_c, 'admin@gama.cz', 'admin'),
    (org_e1, admin_e1, 'e1@duplicita.cz', 'admin'), (org_e2, admin_e2, 'e2@duplicita.cz', 'admin');

  -- Faktury A -> B: otevřená z dřívějška, zaplacená historie, stornovaná. IČO s mezerami se normalizuje.
  insert into invoices(organization_id, invoice_number, counterparty_name, counterparty_ico, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by, created_at)
  values (org_a, 'A-1', 'Beta a.s.', '123 456 10', 'faktury@beta.cz', 10000, 0, 10000, 'CZK',
    current_date - 40, current_date + 5, 'pending', admin_a, now() - interval '40 days')
  returning id into inv_open;
  insert into invoices(organization_id, invoice_number, counterparty_name, counterparty_ico, counterparty_email,
    amount_without_vat, vat_rate, amount, paid_amount, currency, issue_date, due_date, status, paid_at, created_by, created_at)
  values (org_a, 'A-0', 'Beta a.s.', '12345610', 'faktury@beta.cz', 500, 0, 500, 500, 'CZK',
    current_date - 90, current_date - 76, 'paid', now() - interval '70 days', admin_a, now() - interval '90 days')
  returning id into inv_paid_history;
  insert into invoices(organization_id, invoice_number, counterparty_name, counterparty_ico, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by, created_at)
  values (org_a, 'A-X', 'Beta a.s.', '12345610', 'faktury@beta.cz', 900, 0, 900, 'CZK',
    current_date - 20, current_date - 6, 'cancelled', admin_a, now() - interval '20 days')
  returning id into inv_cancelled;
  -- B -> A: po splatnosti (status ještě pending, cron neproběhl).
  insert into invoices(organization_id, invoice_number, counterparty_name, counterparty_ico, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by, created_at)
  values (org_b, 'B-1', 'Alfa s.r.o.', '12345601', 'admin@alfa.cz', 4000, 0, 4000, 'EUR',
    current_date - 30, current_date - 2, 'pending', admin_b, now() - interval '30 days')
  returning id into inv_b_to_a;
  -- A -> C: C není propojená, nesmí ji nikdy vidět nikdo jiný.
  insert into invoices(organization_id, invoice_number, counterparty_name, counterparty_ico, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by, created_at)
  values (org_a, 'A-C', 'Gama s.r.o.', '12345628', 'admin@gama.cz', 777, 0, 777, 'CZK',
    current_date - 3, current_date + 10, 'pending', admin_a, now() - interval '3 days')
  returning id into inv_a_to_c;

  -- 1) Jen admin hledá a propojuje; čtenář nevidí síť vůbec.
  begin perform network_lookup(org_a, acc_a, '12345610'); raise exception 'expected insufficient_permission';
  exception when others then failed := sqlerrm; end;
  if failed <> 'insufficient_permission' then raise exception 'Accounting could look up: %', failed; end if;
  begin perform network_overview(org_a, viewer_a); raise exception 'expected insufficient_permission';
  exception when others then failed := sqlerrm; end;
  if failed <> 'insufficient_permission' then raise exception 'Viewer saw network: %', failed; end if;
  begin perform network_overview(org_a, admin_b); raise exception 'expected insufficient_permission';
  exception when others then failed := sqlerrm; end;
  if failed <> 'insufficient_permission' then raise exception 'Foreign user saw network: %', failed; end if;

  result := network_lookup(org_a, admin_a, '123 456 10');
  if result->>'state' <> 'available' or result->'partner'->>'name' <> 'Beta a.s.' then raise exception 'Lookup wrong: %', result; end if;
  if network_lookup(org_a, admin_a, '12345601')->>'state' <> 'self' then raise exception 'Self lookup wrong'; end if;
  if network_lookup(org_a, admin_a, '12345678')->>'state' <> 'invalid_ico' then raise exception 'Invalid ICO accepted'; end if;
  if network_lookup(org_a, admin_a, '12345644')->>'state' <> 'not_on_network' then raise exception 'Unknown ICO wrong'; end if;

  -- 2) Nejednoznačné IČO se nikdy nepřiřadí.
  if network_lookup(org_a, admin_a, '12345636')->>'state' <> 'ambiguous' then raise exception 'Ambiguous ICO resolved'; end if;
  begin perform network_request(org_a, admin_a, '12345636', null, 'search'); raise exception 'expected partner_not_found';
  exception when others then failed := sqlerrm; end;
  if failed <> 'partner_not_found' then raise exception 'Ambiguous partner connected: %', failed; end if;
  if network_lookup(org_e1, admin_e1, '12345601')->>'state' <> 'own_ico_ambiguous' then raise exception 'Ambiguous own ICO allowed'; end if;

  -- 3) Žádost: dokud není přijatá, nikdo nic nevidí.
  conn := (network_request(org_a, admin_a, '12345610', 'Dobrý den, propojme se.', 'search')->>'connection_id')::uuid;
  begin perform network_request(org_a, admin_a, '12345610', null, 'search'); raise exception 'expected already_pending';
  exception when others then failed := sqlerrm; end;
  if failed <> 'already_pending' then raise exception 'Duplicate request: %', failed; end if;
  if network_partner(org_a, admin_a, conn) is not null or network_partner(org_b, admin_b, conn) is not null then
    raise exception 'Pending connection exposes data';
  end if;
  if jsonb_array_length(network_received(org_b, admin_b)) <> 0 then raise exception 'Pending connection leaks received invoices'; end if;
  if network_partner_invoice(org_b, admin_b, inv_open) is not null then raise exception 'Pending connection leaks PDF data'; end if;

  result := network_overview(org_b, admin_b)->'connections'->0;
  if result->>'direction' <> 'incoming' or result->>'requested_by_email' <> 'admin@alfa.cz'
     or (result->'preview'->>'open_count')::int <> 1 or (result->'preview'->>'email_domain_match')::boolean is not true then
    raise exception 'Incoming request preview wrong: %', result;
  end if;
  if network_overview(org_a, admin_a)->'connections'->0->>'requested_by_email' is not null then
    raise exception 'Requester sees own email field as incoming';
  end if;

  begin perform network_respond(org_b, acc_b, conn, true); raise exception 'expected insufficient_permission';
  exception when others then failed := sqlerrm; end;
  if failed <> 'insufficient_permission' then raise exception 'Accounting accepted: %', failed; end if;
  begin perform network_respond(org_a, admin_a, conn, true); raise exception 'expected connection_not_found';
  exception when others then failed := sqlerrm; end;
  if failed <> 'connection_not_found' then raise exception 'Requester accepted own request: %', failed; end if;
  perform network_respond(org_b, admin_b, conn, true);

  -- Nová faktura po propojení.
  insert into invoices(organization_id, invoice_number, counterparty_name, counterparty_ico, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by)
  values (org_a, 'A-2', 'Beta a.s.', '12345610', 'faktury@beta.cz', 2500, 0, 2500, 'CZK',
    current_date, current_date + 14, 'pending', admin_a)
  returning id into inv_new;

  -- 4) Bilance z obou stran se shoduje; historie, storno a cizí faktury nejsou vidět.
  result := network_partner(org_a, acc_a, conn);
  if jsonb_array_length(result->'issued') <> 2 or jsonb_array_length(result->'received') <> 1 then
    raise exception 'A partner view counts wrong: %', result;
  end if;
  if exists (select 1 from jsonb_array_elements(result->'issued') x where (x->>'id')::uuid in (inv_paid_history, inv_cancelled, inv_a_to_c)) then
    raise exception 'History, cancelled or foreign invoice shared: %', result->'issued';
  end if;
  if result->'received'->0->>'status' <> 'overdue' then raise exception 'Overdue not computed live: %', result->'received'; end if;
  if (select (b->>'they_owe')::numeric from jsonb_array_elements(result->'balances') b where b->>'currency' = 'CZK') <> 12500
     or (select (b->>'we_owe')::numeric from jsonb_array_elements(result->'balances') b where b->>'currency' = 'EUR') <> 4000
     or (select (b->>'we_overdue')::numeric from jsonb_array_elements(result->'balances') b where b->>'currency' = 'EUR') <> 4000 then
    raise exception 'A balances wrong: %', result->'balances';
  end if;
  result := network_partner(org_b, admin_b, conn);
  if (select (b->>'we_owe')::numeric from jsonb_array_elements(result->'balances') b where b->>'currency' = 'CZK') <> 12500
     or (select (b->>'they_owe')::numeric from jsonb_array_elements(result->'balances') b where b->>'currency' = 'EUR') <> 4000 then
    raise exception 'B balances do not mirror A: %', result->'balances';
  end if;
  if jsonb_array_length(network_received(org_b, acc_b)) <> 2 then raise exception 'B inbox wrong: %', network_received(org_b, acc_b); end if;
  if network_partner_invoice(org_b, admin_b, inv_open)->'issuer'->>'name' <> 'Alfa s.r.o.' then raise exception 'Partner PDF data missing'; end if;
  if network_partner_invoice(org_b, admin_b, inv_paid_history) is not null then raise exception 'History leaked via PDF route'; end if;
  if network_partner_invoice(org_b, admin_b, inv_a_to_c) is not null then raise exception 'Foreign invoice leaked via PDF route'; end if;
  if network_invoice_context(org_a, admin_a, inv_open)->>'state' <> 'shared' then raise exception 'Invoice context wrong'; end if;
  if network_invoice_context(org_a, admin_a, inv_paid_history)->>'state' <> 'not_shared' then raise exception 'History context wrong'; end if;

  -- 5) Nepropojená firma C nevidí nic.
  if network_partner(org_c, admin_c, conn) is not null then raise exception 'Third company sees connection'; end if;
  if network_partner_invoice(org_c, admin_c, inv_open) is not null or network_partner_invoice(org_c, admin_c, inv_a_to_c) is not null then
    raise exception 'Unconnected company reads invoice';
  end if;
  if jsonb_array_length(network_received(org_c, admin_c)) <> 0 then raise exception 'Unconnected inbox not empty'; end if;
  begin perform network_flag_invoice(org_c, admin_c, inv_a_to_c, 'disputed', 'price', null, null, null); raise exception 'expected invoice_not_found';
  exception when others then failed := sqlerrm; end;
  if failed <> 'invoice_not_found' then raise exception 'Unconnected company flagged: %', failed; end if;

  -- 6) Historii sdílí vystavitel sám.
  perform network_set_share_history(org_a, admin_a, conn, true);
  if jsonb_array_length(network_partner(org_b, admin_b, conn)->'received') <> 3 then raise exception 'Shared history not visible'; end if;
  perform network_set_share_history(org_a, admin_a, conn, false);

  -- 7) Rozpor a oznámená platba: jen dlužník zakládá, jen vystavitel rozhoduje, peníze se nemění.
  select * into before_inv from invoices where id = inv_open;
  begin perform network_flag_invoice(org_a, admin_a, inv_open, 'disputed', 'price', null, null, null); raise exception 'expected invoice_not_found';
  exception when others then failed := sqlerrm; end;
  if failed <> 'invoice_not_found' then raise exception 'Issuer flagged own invoice: %', failed; end if;
  begin perform network_flag_invoice(org_b, acc_b, inv_open, 'disputed', 'other', '  ', null, null); raise exception 'expected note_required';
  exception when others then failed := sqlerrm; end;
  if failed <> 'note_required' then raise exception 'Other without note: %', failed; end if;
  flag_id := (network_flag_invoice(org_b, acc_b, inv_open, 'disputed', 'price', 'Cena neodpovídá nabídce.', null, null)->>'flag_id')::uuid;
  begin perform network_flag_invoice(org_b, acc_b, inv_open, 'disputed', 'quantity', null, null, null); raise exception 'expected flag_exists';
  exception when others then failed := sqlerrm; end;
  if failed <> 'flag_exists' then raise exception 'Duplicate flag: %', failed; end if;
  begin perform network_flag_invoice(org_b, acc_b, inv_open, 'payment_claimed', null, null, current_date, 10000.01); raise exception 'expected invalid_amount';
  exception when others then failed := sqlerrm; end;
  if failed <> 'invalid_amount' then raise exception 'Overpayment claim: %', failed; end if;
  claim_id := (network_flag_invoice(org_b, acc_b, inv_open, 'payment_claimed', null, null, current_date, 10000)->>'flag_id')::uuid;
  select * into after_inv from invoices where id = inv_open;
  if after_inv.status <> before_inv.status or after_inv.paid_amount <> before_inv.paid_amount or after_inv.paid_at is not null then
    raise exception 'Flag changed money state';
  end if;
  begin perform network_decide_flag(org_b, admin_b, flag_id, 'resolved', null); raise exception 'expected insufficient_permission';
  exception when others then failed := sqlerrm; end;
  if failed <> 'insufficient_permission' then raise exception 'Recipient resolved flag: %', failed; end if;
  begin perform network_decide_flag(org_a, admin_a, claim_id, 'withdrawn', null); raise exception 'expected insufficient_permission';
  exception when others then failed := sqlerrm; end;
  if failed <> 'insufficient_permission' then raise exception 'Issuer withdrew claim: %', failed; end if;
  perform network_decide_flag(org_a, acc_a, flag_id, 'resolved', 'Posíláme dobropis.');
  if (network_overview(org_a, admin_a)->'connections'->0->>'open_flags')::int <> 1 then raise exception 'Open flag count wrong'; end if;

  -- 8) Opakovaná žádost po odmítnutí je 30 dní blokovaná.
  conn_bc := (network_request(org_c, admin_c, '12345610', null, 'search')->>'connection_id')::uuid;
  perform network_respond(org_b, admin_b, conn_bc, false);
  begin perform network_request(org_c, admin_c, '12345610', null, 'search'); raise exception 'expected recently_declined';
  exception when others then failed := sqlerrm; end;
  if failed <> 'recently_declined' then raise exception 'Declined request repeated: %', failed; end if;

  -- 9) Zrušení: přístup končí hned, otevřené připomínky se uzavřou.
  perform network_revoke(org_b, admin_b, conn);
  if network_partner(org_a, admin_a, conn) is not null or jsonb_array_length(network_received(org_b, admin_b)) <> 0 then
    raise exception 'Revoked connection still exposes data';
  end if;
  if exists (select 1 from network_invoice_flags where connection_id = conn and status = 'open') then raise exception 'Flags left open after revoke'; end if;

  -- 10) Pozvánka firmě mimo Splatno, přijetí jen se shodným IČO, atribuce.
  result := network_issue_invitation(org_a, admin_a, '12345644', 'Fakturace@Nova.cz', token_one, now() + interval '14 days');
  if result->>'invitee_email' <> 'fakturace@nova.cz' or result->>'inviter_name' <> 'Alfa s.r.o.' then raise exception 'Invitation wrong: %', result; end if;
  perform network_mark_invitation_sent((result->>'invitation_id')::uuid);
  begin perform network_issue_invitation(org_a, admin_a, '12345644', 'fakturace@nova.cz', token_two, now() + interval '14 days'); raise exception 'expected recently_invited';
  exception when others then failed := sqlerrm; end;
  if failed <> 'recently_invited' then raise exception 'Invitation spam: %', failed; end if;
  begin perform network_issue_invitation(org_a, admin_a, '12345610', 'x@beta.cz', token_two, now() + interval '14 days'); raise exception 'expected already_on_network';
  exception when others then failed := sqlerrm; end;
  if failed <> 'already_on_network' then raise exception 'Invited existing company: %', failed; end if;
  if network_invitation_preview(token_one)->>'state' <> 'valid' or network_invitation_preview(token_bad) is not null then
    raise exception 'Invitation preview wrong';
  end if;

  insert into organizations(id, name, ico) values (org_f, 'Nová firma s.r.o.', '12345644'), (org_g, 'Jiná firma s.r.o.', '12345652');
  insert into organization_members(organization_id, user_id, email, role) values
    (org_f, admin_f, 'f@nova.cz', 'admin'), (org_g, admin_g, 'g@jina.cz', 'admin');
  begin perform network_accept_invitation(org_g, admin_g, token_one); raise exception 'expected ico_mismatch';
  exception when others then failed := sqlerrm; end;
  if failed <> 'ico_mismatch' then raise exception 'Invitation accepted by wrong company: %', failed; end if;
  result := network_accept_invitation(org_f, admin_f, token_one);
  if result->>'status' <> 'active' then raise exception 'Invitation not accepted: %', result; end if;
  if (select referred_by_org from organizations where id = org_f) is distinct from org_a then raise exception 'Referral not attributed'; end if;
  begin perform network_accept_invitation(org_f, admin_f, token_one); raise exception 'expected invitation_used';
  exception when others then failed := sqlerrm; end;
  if failed <> 'invitation_used' then raise exception 'Invitation reused: %', failed; end if;

  -- 11) Odhlášení z pozvánek platí pro všechny firmy.
  result := network_issue_invitation(org_b, admin_b, '12345661', 'nechci@firma.cz', token_two, now() + interval '14 days');
  if not network_invitation_opt_out(token_two) then raise exception 'Opt-out failed'; end if;
  begin perform network_issue_invitation(org_c, admin_c, '12345661', 'nechci@firma.cz', token_bad, now() + interval '14 days'); raise exception 'expected email_suppressed';
  exception when others then failed := sqlerrm; end;
  if failed <> 'email_suppressed' then raise exception 'Opted-out address invited: %', failed; end if;

  -- 12) Klient (anon/authenticated) nemá k síti žádný přímý přístup.
  if has_function_privilege('authenticated', 'public.network_overview(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.network_invitation_preview(text)', 'execute')
     or has_function_privilege('authenticated', 'public.network_flag_invoice(uuid,uuid,uuid,text,text,text,date,numeric)', 'execute') then
    raise exception 'Client can execute network functions';
  end if;
  if has_table_privilege('authenticated', 'public.organization_connections', 'select')
     or has_table_privilege('authenticated', 'public.network_invoice_flags', 'insert')
     or has_table_privilege('anon', 'public.network_invitations', 'select') then
    raise exception 'Client can read network tables';
  end if;
end $$;
rollback;

-- Nálezy z revize: změna IČO po propojení, návrhy pro cizí IČO, faktura
-- otevřená při propojení a zaplacená zpětným datem, importovaná historie,
-- pozvánka po připomínce.
begin;
do $$
declare
  admin_x uuid := gen_random_uuid(); admin_y uuid := gen_random_uuid(); admin_s uuid := gen_random_uuid(); admin_q uuid := gen_random_uuid();
  org_x uuid := gen_random_uuid(); org_y uuid := gen_random_uuid(); org_s uuid := gen_random_uuid(); org_q uuid := gen_random_uuid();
  conn uuid; inv_open uuid; inv_imported uuid; result jsonb; token_one text := repeat('d', 64); token_two text := repeat('e', 64);
  invitation uuid;
begin
  insert into auth.users(id, email) values (admin_x, 'x@iks.cz'), (admin_y, 'y@ypsilon.cz'), (admin_s, 's@squat.cz'), (admin_q, 'q@kvalita.cz');
  insert into organizations(id, name, ico, created_at) values
    (org_x, 'Iks s.r.o.', '12345601', now() - interval '1 year'),
    (org_y, 'Ypsilon s.r.o.', '12345610', now() - interval '1 year'),
    (org_s, 'Squatter s.r.o.', '12345628', now() - interval '1 year'),
    (org_q, 'Kvalita s.r.o.', '12345687', now() - interval '1 year');
  insert into organization_members(organization_id, user_id, email, role) values
    (org_x, admin_x, 'x@iks.cz', 'admin'), (org_y, admin_y, 'y@ypsilon.cz', 'admin'),
    (org_s, admin_s, 's@squat.cz', 'admin'), (org_q, admin_q, 'q@kvalita.cz', 'admin');

  -- X fakturuje Y (otevřená před propojením) a firmě V mimo Splatno (IČO 12345695).
  insert into invoices(organization_id, invoice_number, counterparty_name, counterparty_ico, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by, created_at)
  values (org_x, 'X-Y', 'Ypsilon s.r.o.', '12345610', 'y@ypsilon.cz', 1000, 0, 1000, 'CZK',
    current_date - 10, current_date + 5, 'pending', admin_x, now() - interval '10 days') returning id into inv_open;
  insert into invoices(organization_id, invoice_number, counterparty_name, counterparty_ico, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by, created_at)
  values (org_x, 'X-V', 'Véčko s.r.o.', '12345695', 'ucetni@vecko.cz', 99999, 0, 99999, 'CZK',
    current_date - 10, current_date + 5, 'pending', admin_x, now() - interval '10 days');
  -- Q fakturuje X na adresu člena X: oprávněný návrh „fakturují vám“.
  insert into invoices(organization_id, invoice_number, counterparty_name, counterparty_ico, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by, created_at)
  values (org_q, 'Q-X', 'Iks s.r.o.', '12345601', 'x@iks.cz', 500, 0, 500, 'CZK',
    current_date - 3, current_date + 10, 'pending', admin_q, now() - interval '3 days');

  conn := (network_request(org_y, admin_y, '12345601', null, 'search')->>'connection_id')::uuid;
  perform network_respond(org_x, admin_x, conn, true);
  if (select requester_ico from organization_connections where id = conn) <> '12345610'
     or (select addressee_ico from organization_connections where id = conn) <> '12345601' then
    raise exception 'Connection does not pin both IČO';
  end if;

  -- a) Faktura otevřená při propojení, zaplacená s datem platby PŘED propojením, zůstává vidět.
  update invoices set status = 'paid', paid_amount = amount, paid_at = now() - interval '2 hours',
    next_reminder_at = null where id = inv_open;
  update organization_connections set activated_at = now() - interval '1 hour' where id = conn;
  if jsonb_array_length(network_received(org_y, admin_y)) <> 1 then
    raise exception 'Invoice open at activation vanished after backdated payment: %', network_received(org_y, admin_y);
  end if;

  -- b) Importovaná, už dávno zaplacená faktura (initial_paid) se nesdílí bez souhlasu a nekazí morálku.
  insert into invoices(organization_id, invoice_number, counterparty_name, counterparty_ico, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by, money_evidence)
  values (org_x, 'X-OLD', 'Ypsilon s.r.o.', '12345610', 'y@ypsilon.cz', 700, 0, 700, 'CZK',
    current_date - 400, current_date - 386, 'pending', admin_x,
    jsonb_build_object('original_total', 700, 'initial_paid', 700, 'initial_paid_confirmed', true, 'total_source', 'manual'))
  returning id into inv_imported;
  if (select status from invoices where id = inv_imported) <> 'paid' then raise exception 'Fixture: import not paid'; end if;
  result := network_partner(org_y, admin_y, conn);
  if exists (select 1 from jsonb_array_elements(result->'received') x where (x->>'id')::uuid = inv_imported) then
    raise exception 'Imported paid history shared without consent';
  end if;
  perform network_set_share_history(org_x, admin_x, conn, true);
  result := network_partner(org_y, admin_y, conn);
  if not exists (select 1 from jsonb_array_elements(result->'received') x where (x->>'id')::uuid = inv_imported) then
    raise exception 'Shared history does not include imported invoice';
  end if;
  if coalesce((result->'behaviour'->'we_pay'->>'avg_days_late')::numeric, 0) > 30 then
    raise exception 'Imported payment date distorts payment behaviour: %', result->'behaviour';
  end if;

  -- c) Změna vlastního IČO po propojení nesmí ukázat faktury jiné firmy; propojení končí.
  update organizations set ico = '12345695' where id = org_y;
  if exists (select 1 from jsonb_array_elements(network_received(org_y, admin_y)) x where x->>'invoice_number' = 'X-V') then
    raise exception 'IČO change exposed a third company''s invoice';
  end if;
  if (select status from organization_connections where id = conn) <> 'revoked' then
    raise exception 'Connection survived an IČO change';
  end if;
  update organizations set ico = '12345610' where id = org_y;

  -- d) Firma s cizím IČO nevidí dodavatele té firmy v návrzích; oprávněný návrh zůstává.
  update organizations set ico = '12345695' where id = org_s;
  if exists (select 1 from jsonb_array_elements(network_overview(org_s, admin_s)->'suggestions') x
             where x->'partner'->>'name' = 'Iks s.r.o.') then
    raise exception 'Supplier list leaked to an org holding someone else''s IČO';
  end if;
  if not exists (select 1 from jsonb_array_elements(network_overview(org_x, admin_x)->'suggestions') x
                 where x->'partner'->>'name' = 'Kvalita s.r.o.' and x->>'relation' = 'supplier') then
    raise exception 'Legitimate supplier suggestion missing: %', network_overview(org_x, admin_x)->'suggestions';
  end if;

  -- e) Připomínka pozvánky nezneplatní odkaz z prvního e-mailu (odhlášení ani náhled).
  invitation := (network_issue_invitation(org_x, admin_x, '12345644', 'prvni@nova.cz', token_one, now() + interval '14 days')->>'invitation_id')::uuid;
  perform network_mark_invitation_sent(invitation);
  update network_invitations set sent_at = now() - interval '8 days' where id = invitation;
  perform network_issue_invitation(org_x, admin_x, '12345644', 'druha@nova.cz', token_two, now() + interval '14 days');
  if network_invitation_preview(token_one) is null then raise exception 'First invitation link died after reminder'; end if;
  if not network_invitation_opt_out(token_one) then raise exception 'First invitation opt-out died after reminder'; end if;
  if not exists (select 1 from network_invitation_optouts where email = 'prvni@nova.cz') then
    raise exception 'Opt-out recorded for the wrong address';
  end if;
end $$;
rollback;
