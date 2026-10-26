begin;
do $$
declare org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); invoice_id uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); foreign_customer uuid:=gen_random_uuid(); doc jsonb; report jsonb; saved public.invoices; blocked boolean;
begin
  insert into auth.users(id,email) values(actor,actor||'@example.invalid');
  insert into public.organizations(id,name,ico) values(org,'Creation supplier','12345678'),(other_org,'Other supplier','87654321');
  insert into public.subscriptions(organization_id,status,plan,period,billing_exempt) values(org,'active','business','yearly',true);
  insert into public.organization_members(organization_id,user_id,email,role) values(org,actor,actor||'@example.invalid','admin');
  insert into public.customers(id,organization_id,name,address) values(customer,org,'Private person','Praha 1'),(foreign_customer,other_org,'Foreign customer','Brno 1');
  doc:=jsonb_build_object('version',1,'request_id',invoice_id,'customer_id',customer,'supplier',jsonb_build_object('name','Original supplier'),'totals',jsonb_build_object('net',1500,'gross',1770,'breakdown',jsonb_build_array(jsonb_build_object('rate',21,'net',1000,'tax',210,'gross',1210),jsonb_build_object('rate',12,'net',500,'tax',60,'gross',560))));
  insert into public.invoices(id,organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by,money_evidence)
    values(invoice_id,org,'ISSUE-1','Private person','',1500,0,1770,'CZK','2026-10-25','2026-11-08',actor,
      jsonb_build_object('original_total',1770,'total_source','manual','initial_paid',0,'initial_paid_confirmed',false,'multi_rate',true,'issued_document',doc)) returning * into saved;
  if saved.customer_id<>customer or not saved.reminders_paused or saved.next_reminder_at is not null then raise exception 'customer link or no-email reminder state incorrect'; end if;
  report:=public.invoice_report_summary(org,actor,'2026-10-01','2026-10-31','issue_date','CZK',null,null,'2026-10-25');
  if not report->'vat_breakdown' @> '[{"vat_rate":21,"base":1000,"tax":210,"gross":1210,"count":1},{"vat_rate":12,"base":500,"tax":60,"gross":560,"count":1}]'::jsonb then raise exception 'mixed VAT report incorrect: %', report->'vat_breakdown'; end if;
  blocked:=false;
  begin update public.invoices set money_evidence=jsonb_set(money_evidence,'{issued_document,supplier,name}','"Changed supplier"') where id=invoice_id;
  exception when others then if sqlerrm like '%issued_document_is_immutable%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'snapshot rewrite accepted'; end if;
  blocked:=false;
  begin update public.invoices set amount=1800 where id=invoice_id;
  exception when others then if sqlerrm like '%issued_document_is_immutable%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'issued amount rewrite accepted'; end if;
  update public.invoices set status='cancelled' where id=invoice_id;
  if (select money_evidence->'issued_document' from public.invoices where id=invoice_id)<>doc then raise exception 'status change lost document'; end if;
  blocked:=false;
  begin insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by)
    values(org,'ISSUE-1','Duplicate','contact@example.invalid',100,0,100,'CZK','2026-10-25','2026-11-08',actor);
  exception when unique_violation then blocked:=true; end;
  if not blocked then raise exception 'duplicate invoice number accepted'; end if;
  blocked:=false;
  invoice_id:=gen_random_uuid(); doc:=jsonb_set(jsonb_set(doc,'{request_id}',to_jsonb(invoice_id)),'{customer_id}',to_jsonb(foreign_customer));
  begin insert into public.invoices(id,organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by,money_evidence)
    values(invoice_id,org,'FOREIGN','Foreign','contact@example.invalid',1500,0,1770,'CZK','2026-10-25','2026-11-08',actor,jsonb_build_object('original_total',1770,'total_source','manual','initial_paid',0,'issued_document',doc));
  exception when others then if sqlerrm like '%invalid_invoice_customer%' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'cross-tenant customer accepted'; end if;
end $$;
rollback;
