import type { ReminderStage } from "../types/invoice";

export const defaultReminderTemplates: Record<ReminderStage, { subject: string; body: string }> = {
  before_due: {
    subject: "Blížící se splatnost faktury {{invoice_number}}",
    body: "Dobrý den,\n\nupozorňujeme, že faktura {{invoice_number}} ve výši {{amount}} {{currency}} bude splatná dne {{due_date}}.\n\nDěkujeme\nHlavica Dřevo",
  },
  on_due: {
    subject: "Faktura {{invoice_number}} je dnes splatná",
    body: "Dobrý den,\n\ndnes je splatná faktura {{invoice_number}} ve výši {{amount}} {{currency}}.\n\nDěkujeme\nHlavica Dřevo",
  },
  overdue: {
    subject: "Upozornění na neuhrazenou fakturu {{invoice_number}}",
    body: "Dobrý den,\n\nneevidujeme úhradu faktury {{invoice_number}}, splatné dne {{due_date}}. Prosíme o kontrolu platby.\n\nDěkujeme\nHlavica Dřevo",
  },
  escalation: {
    subject: "Opakovaná výzva k úhradě faktury {{invoice_number}}",
    body: "Dobrý den,\n\nfaktura {{invoice_number}} je nadále po splatnosti. Žádáme o neodkladnou úhradu částky {{amount}} {{currency}}.\n\nHlavica Dřevo",
  },
};
