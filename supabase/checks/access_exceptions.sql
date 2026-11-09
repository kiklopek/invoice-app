-- Výjimky v přístupu, které musí na produkci trvale platit (rozhodnutí
-- uživatele 9. 11. 2026). Jen čtení; každý řádek musí mít ok = true.
--   * test-admin@hlavica.cz: obchází ověření kódem (src/lib/email-mfa-core.ts),
--     proto smí být jen členem R. Hlavica, nikdy provozovatelem.
--   * R. Hlavica (IČO 26296039) neplatí předplatné (billing_exempt).
--   * Provozovatel (SPLATNO_OPERATOR_EMAILS na Vercelu) vstupuje do firem přes
--     support relaci s ověřením kódem a sám není členem žádné firmy.
--     Zde nastavit stejnou adresu jako ve Vercelu:
with operator as (select 'teda.trnka@gmail.com'::text as email)
select 'test-admin exists' as check, exists (select 1 from auth.users where lower(email) = 'test-admin@hlavica.cz') as ok
union all
select 'test-admin is admin of R. Hlavica only',
  coalesce((select bool_and(o.ico = '26296039' and m.role = 'admin') and count(*) >= 1
            from public.organization_members m join public.organizations o on o.id = m.organization_id
            where lower(m.email) = 'test-admin@hlavica.cz'), false)
union all
select 'R. Hlavica is billing exempt',
  exists (select 1 from public.subscriptions s join public.organizations o on o.id = s.organization_id
          where o.ico = '26296039' and s.billing_exempt)
union all
select 'operator account exists', exists (select 1 from auth.users u, operator where lower(u.email) = operator.email)
union all
select 'operator is not a member of any company',
  not exists (select 1 from public.organization_members m, operator where lower(m.email) = operator.email)
union all
select 'support session functions are server-only',
  coalesce((select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')
                       and not has_function_privilege('anon', p.oid, 'EXECUTE')
                       and not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
            from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('start_support_session', 'end_support_session')), false);
