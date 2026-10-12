// Předmět e-mailu s upomínkou i s odeslanou fakturou: „Firma – Faktura číslo“.
// Odběratel hned vidí, kdo píše a o kterou fakturu jde. Je stejný pro všechny
// fáze upomínek a nastavuje se tady, ne v šabloně firmy. Splatno v předmětu
// záměrně není. Používá ho odeslání (src/lib/email.ts) i náhled v Upomínkách.
export function reminderEmailSubject(companyName: string | null | undefined, invoiceNumber: string) {
  // Bez zalomení řádků (jinak by šlo podstrčit další hlavičku) a rozumně dlouhé.
  const name = (companyName ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const invoice = `Faktura ${invoiceNumber}`;
  return name ? `${name} – ${invoice}` : invoice;
}
