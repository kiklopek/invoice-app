-- Plátce DPH u firmy. Splatno předpokládalo, že každá firma je plátce DPH
-- (21 %, řádky DPH na PDF). Neplátci (OSVČ, malé firmy) pak dostávali
-- předvyplněných 21 % a PDF s DPH, které nesmějí uvádět.
-- null = neuvedeno (chová se jako plátce, tj. jako dosud); stávající firmy
-- (R. Hlavica) jsou plátci.
alter table public.organizations add column if not exists vat_payer boolean;
update public.organizations set vat_payer = true where vat_payer is null;
