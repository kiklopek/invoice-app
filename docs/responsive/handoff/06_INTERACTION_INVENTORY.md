# 06 — Registr interaktivních prvků

Inventura zdrojů větve `responsive/extended`, základ `540cee5`, 7. 11. 2026.
Níže jsou existující prvky a podklady k dalším mockupům. **Všechny zde uvedené otevřené
scény čekají na zachycení, návrh a ověření**, pokud nejsou doložené samostatným artefaktem.
Přítomnost komponenty v kódu není důkazem schváleného vzhledu ani její bezchybnosti.
Cesty jsou relativní ke kořeni repozitáře; zdrojové soubory nejsou součástí zipu.

## Sdílené prvky

| Varianta | Rodina | Existující použití | Zdroj |
| --- | --- | --- | --- |
| global-confirm | I01 | Potvrzování změn, odhlášení a destruktivních akcí | `src/lib/confirm-action.ts` a jeho volající |
| global-search | I06 | Výsledky hledání ve workspace | `src/components/search/workspace-search.tsx` |
| mobile-search | I02/I06 | Mobilní hledání v dialogu | `src/components/layout/mobile-header-search.tsx` |
| notifications-panel | I09 | Zvonek, přečtení a seznam oznámení | `src/components/layout/workspace-notifications.tsx` |
| mobile-navigation | I10 | Mobilní vysouvací menu | `src/components/layout/app-shell.tsx` |
| operation-toast | I12 | Úspěch, informace, chyba | `src/components/toast.tsx` |
| esko-panel | I13 | Nemodální asistent a jeho existující stavy | `src/components/esko/esko-assistant.tsx` |
| portrait-guard | I15 | Ochrana mobilní orientace | `src/components/layout/mobile-portrait-guard.tsx` |
| amount-tooltip | I08 | Úplná částka při kompaktním zobrazení | `src/components/money-amount.tsx` |
| ocr-source-tooltip | I08 | Původ rozpoznaného údaje a vysvětlení | `src/components/ocr-source-note.tsx` |

Podklady geometrie existujících popupů: `src/components/popup-fitter.tsx` a
`src/lib/popup-fit.ts`. Zachovat kontextové výjimky, ne pouze mechanicky sjednotit z-index.

## Stránky a konkrétní varianty

| Stránka | Varianty ke zpracování | Rodiny | Zdroj |
| --- | --- | --- | --- |
| Nástěnka | dashboard-period, dashboard-row-actions, dashboard-widget-disclosure | I04/I05/I11 | `src/app/(workspace)/dashboard/dashboard-client.tsx`, `dashboard-widgets.tsx` |
| Faktury | invoices-row-actions, invoices-filters, invoices-mobile-filters, invoices-page-menu, invoices-payment-confirm, invoices-page-size | I01/I04/I05/I07 | `src/app/(workspace)/invoices/invoices-client.tsx`, `invoice-row-actions.tsx`, `mobile-invoice-filters.tsx` |
| Tvorba faktury | creation-customer-search, creation-customer-dialog, creation-billing-disclosure, creation-item-menu, creation-action-menu, creation-selects, creation-send-confirm, creation-number-info, creation-pdf | I01/I02/I03/I04/I05/I06/I11 | `src/components/invoice-creation/invoice-creation.tsx` |
| Ruční faktura | manual-customer-search, manual-policy-select, manual-currency-select, manual-ocr-warnings | I05/I06/I11 | `src/components/invoice-form.tsx`, `src/components/optional-payment-assignment.tsx` |
| Import faktur | import-document-picker, import-guidance, import-ocr-source, import-review-fields | I04/I05/I06/I08/I11 | `src/app/(workspace)/invoices/import/ocr-document-picker.tsx`, `page.tsx`, sdílený `invoice-form.tsx` a `ocr-source-note.tsx` |
| Archiv faktur | archive-status-select, archive-currency-select | I05 | `src/app/(workspace)/invoices/archive/page.tsx` |
| Detail faktury | detail-actions, detail-payment-confirm, detail-payment-date, detail-delete, detail-send-confirm, detail-cancel-confirm, detail-release-payment, detail-history, detail-reminder-history, detail-payment-details | I01/I02/I04/I11 | `src/app/(workspace)/invoices/[id]/invoice-detail-client.tsx`, `invoice-detail-workspace.tsx` |
| Zákazníci | customers-search | Běžné vyhledávací pole, bez vlastního popupu v aktuálním zdroji | `src/app/(workspace)/customers/customers-client.tsx`; nevytvářet nový našeptávač |
| Upomínky | reminders-category, reminders-step-select, reminders-confirmations, reminders-operations, reminders-email-details, reminders-suppressions | I01/I05/I11 | `src/app/(workspace)/reminders/reminders-client.tsx`, `email-templates-section.tsx`, `email-suppressions-panel.tsx` |
| Reporty | reports-period, reports-filters, reports-mobile-controls, reports-chart-tooltip, reports-more, reports-methodology, reports-customers, reports-export | I02/I05/I07/I08/I11 | `src/app/(workspace)/reports/reports-client.tsx`, `report-mobile-controls.tsx`, `src/components/financial-report/financial-report-export.tsx` |
| Platby / párování | matching-filters, matching-invoice-dropdown, matching-payment-info, matching-status-tooltip, matching-split, matching-account-warning, matching-technical, matching-confirmations, matching-guidance | I01/I05/I07/I08/I11/I14 | `src/app/(workspace)/invoices/payments/payment-matching-popover.tsx`, `payment-matching-workspace.tsx`, `gpc-import-panel.tsx`, `bank-matching-process-info.tsx` |
| Archiv plateb | payments-archive-selects, payments-archive-confirmations, payments-statement-delete, payments-assistance-disclosures, payments-source-select | I01/I05/I11 | `src/app/(workspace)/invoices/payments/archive/payments-archive-client.tsx`, `statement-archive.tsx`, `payment-assistance-panel.tsx` |
| Oznámení | notifications-loading, notifications-empty, notifications-error, notifications-read-action | I09 pouze sdílený zvonek; stránka je seznam | `src/components/notifications/notification-list.tsx`, `src/app/(workspace)/notifications/notifications-client.tsx` |
| Nastavení | settings-additional, settings-selects, settings-bank-accounts, settings-bank-remove, settings-access-confirmations, settings-access-history | I01/I05/I11 | `src/app/(workspace)/settings/settings-client.tsx`, `bank-accounts-section.tsx` |
| Předplatné | subscription-menu, subscription-confirmations | I01/I04 | `src/app/(workspace)/predplatne/subscription-client.tsx` |

`creation-selects` zahrnuje stávající měnu, způsob úhrady, bankovní účet a další výběry
ve formuláři; `creation-customer-search` také nulový výsledek a přidání zákazníka přes
existující akci. `reports-export` zachycuje všechny existující volby exportu a jeho stav.
U potvrzení zachytit odlišný obsah a důsledky jednotlivých akcí, nejen jeden univerzální dialog.

## Meze inventury a práce s variantami

- U každé varianty nejprve ověřit přesnou cestu a existující obsah ve zdroji nebo v aplikaci.
  Názvy variant jsou pracovní identifikátory mockupů, nikoli nové názvy funkcí v aplikaci.
- Rodiny I05 a I07 zahrnují datumová pole: nativní picker zachovat, vlastní kalendář nepřidávat.
- Běžný input, odkaz nebo tlačítko není automaticky popup. U Zákazníků a Oznámení
  nevymýšlet nové menu, dialog nebo našeptávač jen pro zaplnění registru.
- Ve zdrojích jsou i `window.confirm` (např. Upomínky a Nastavení). Systémové okno
  nelze nastylovat jako HTML; dokumentovat existující tok. Náhrada vlastním dialogem
  je samostatná změna chování, kterou tento návrhový balíček sám nezadává.
- Při dalších změnách zdrojů znovu projít výskyty `Modal`, `confirmAction`, `window.confirm`,
  `select`, `details`, `data-popup`, `aria-haspopup`, `listbox`, `tooltip` a `createPortal`.
  Tento registr není automatická záruka pokrytí budoucích komponent.

## Evidence pro každou odevzdanou scénu

| Pole | Co vyplnit |
| --- | --- |
| Varianta / rodina | Např. invoices-row-actions / I04 |
| Stav a kontext | Otevřeno, poslední řádek, pravý dolní okraj |
| Referenční pilíř | Přesný soubor otevřeného stavu, nebo „chybí“ |
| HTML / screenshot | Relativní cesta a viewport |
| Ovládání | Myš / dotyk / klávesnice, doložený postup |
| Kontroly | PASS / FAIL / N/A s důvodem / NEOVĚŘENO |
| Stav návrhu | Návrh / předáno k revizi / schváleno s konkrétní verzí |

Pořadí: sdílené nabídky a výběry → formulářové a potvrzovací dialogy → dokumenty →
oznámení, tooltipy a toast → accordion a pomocné panely. Pro každou rodinu použít
alespoň krátký a dlouhý obsah a pro každé odlišné kotvení samostatný scénář.
