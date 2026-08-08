-- Produkční přístup je omezen výhradně na firemní adresy @hlavica.cz.
-- Před spuštěním migrace odstraňte případné staré členy s jinou doménou.
alter table organization_members
  drop constraint if exists organization_members_email_domain_check;

alter table organization_members
  add constraint organization_members_email_domain_check
  check (email ~ '^[^@[:space:]]+@gmail\.com$');
