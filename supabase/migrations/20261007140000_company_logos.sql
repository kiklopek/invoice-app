-- Vlastní logo firmy (onboarding a Nastavení → Firma).
-- Soubor leží v soukromém úložišti company-logos/<firma>/logo; ven ho dává
-- route /logo/<firma> (aplikace i e-maily s upomínkami). organizations.logo_path
-- tedy nově smí být i /logo/<uuid>?v=<čas> (číslo verze kvůli mezipaměti).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', false, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

alter table public.organizations drop constraint if exists organizations_logo_path_format;
alter table public.organizations add constraint organizations_logo_path_format check (
  logo_path is null
  or logo_path ~ '^/brand/[a-z0-9_-]+\.(png|webp|svg)$'
  or logo_path ~ '^/logo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\?v=[0-9]{1,15}$'
);
