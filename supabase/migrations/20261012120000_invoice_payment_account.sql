-- Účet, na který se má faktura platit, když ho čtení z PDF (OCR) našlo na
-- jejím dokladu a patří firmě (hlavní CZK/EUR nebo organization_bank_accounts).
-- PDF, QR platba i upomínky ho pak používají místo prvního účtu v měně
-- (src/lib/bank-accounts.ts invoicePaymentAccount). null = výchozí účet pro
-- měnu jako dosud; stávající faktury zůstávají null.
-- Ukládá ho jen POST /api/invoices po ověření, že je to účet firmy v měně
-- faktury (ownInvoiceAccount). Žádná funkce se nemění: faktury se vkládají přímo.
alter table public.invoices
  add column if not exists payment_account text
    check (payment_account is null or (length(payment_account) between 6 and 64 and payment_account !~ '\s'));
