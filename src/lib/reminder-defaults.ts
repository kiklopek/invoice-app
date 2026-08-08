import type { ReminderStage } from "../types/invoice";

export const defaultReminderTemplates: Record<ReminderStage, { subject: string; body: string }> = {
  before_due: {
    subject: "Připomenutí splatnosti faktury {{invoice_number}}",
    body: `Dobrý den,

rádi bychom Vám připomněli, že se blíží splatnost následující faktury:

Prosíme o úhradu v uvedeném termínu. Pokud jste platbu již zadali, považujte tuto zprávu za bezpředmětnou.

V případě dotazů nám stačí odpovědět na tento e-mail. Děkujeme a přejeme příjemný den.`,
  },
  on_due: {
    subject: "Faktura {{invoice_number}} je dnes splatná",
    body: `Dobrý den,

dovolujeme si připomenout, že dnes nastává splatnost této faktury:

Prosíme o její úhradu. Pokud jste platbu již odeslali, není potřeba nic dalšího řešit.

V případě nejasností nám prosím odpovězte na tento e-mail. Děkujeme.`,
  },
  overdue: {
    subject: "Upomínka k faktuře {{invoice_number}} po splatnosti",
    body: `Dobrý den,

podle naší evidence dosud neevidujeme úhradu následující faktury po splatnosti:

Prosíme o kontrolu a úhradu dlužné částky v nejbližším možném termínu. Pokud jste již platbu odeslali, považujte tuto zprávu za bezpředmětnou.

Pokud potřebujete cokoli upřesnit, odpovězte nám prosím na tento e-mail. Děkujeme za spolupráci.`,
  },
  escalation: {
    subject: "Opakovaná výzva k úhradě faktury {{invoice_number}}",
    body: `Dobrý den,

obracíme se na Vás opakovaně ve věci níže uvedené faktury, kterou nadále evidujeme jako neuhrazenou:

Žádáme Vás o neodkladnou úhradu celé dlužné částky. Pokud úhradě brání nesrovnalost nebo jiný důvod, kontaktujte nás prosím bez zbytečného odkladu odpovědí na tento e-mail.

Jestliže jste platbu již provedli, zašlete nám prosím potvrzení o úhradě.

Děkujeme za rychlé vyřízení.`,
  },
};
