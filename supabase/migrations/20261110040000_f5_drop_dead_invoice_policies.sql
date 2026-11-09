-- Fáze F5 přestavby databáze (úklid): faktury zapisuje jen server přes
-- funkce, které samy ověřují roli. Role authenticated na invoices právo
-- INSERT/UPDATE nemá, takže tahle dvě pravidla nikdy nic nepovolila a jen
-- mátla při revizi bezpečnosti. Čtení (SELECT) a jeho pravidlo zůstávají.
drop policy if exists "accounting can create invoices" on public.invoices;
drop policy if exists "accounting can update invoices" on public.invoices;
