-- The customer registry's self-guard ("never store our own identity as a
-- customer", 20260919124500) reads organizations.ico as its one source of
-- truth. That guard is silently useless whenever this column is null or
-- malformed, because a coalesced empty string never equals an 8-digit
-- counterparty ICO -- the check just never fires, with no error anywhere to
-- notice it. The settings PUT route already rejects a non-8-digit ICO on
-- save, but nothing stopped a null/garbage value at the database level
-- itself, and customers.ico already carries this exact constraint.
--
-- Safe to make NOT NULL: no code path creates an organizations row except
-- the manual seed in the baseline migration -- there is no self-service
-- signup that could hit this before a company's ICO is known.
alter table organizations alter column ico set not null;
alter table organizations add constraint organizations_ico_format check (ico ~ '^[0-9]{8}$');
