# Invoice detail audit

Route: app/(workspace)/invoices/[id]/page.tsx, SSR loadInvoiceDetailPageData,
InvoiceDetailClient with SWR page-data refresh. Existing shared AppShell/topbar stays.

| Existing function | New location | Existing integration |
| --- | --- | --- |
| Invoice identity/status | Heading and compact badge | Invoice.status, paid_amount; partial presentation only |
| Financial summary | Main card, gross total first | amount, amount_without_vat, paid_amount; minorUnits arithmetic |
| Manual/assigned settlement | Primary header action; existing modal | PATCH /api/invoices/[id]; OptionalPaymentAssignment |
| Paid-date correction/reopen/storno | Header contextual menu | Existing changeStatus and PATCH guards |
| Editing/notes | Header menu; collapsible note | Lazy InvoiceForm, existing saveEdit |
| Invoice email | Header menu with existing confirmation | POST /api/invoices/[id]/send |
| Delete | Secondary header action and existing confirmation | Existing DELETE, no change to server constraints |
| Original document | Right card, actual first-page thumbnail/open/download | Authenticated document route; private signed link at request time |
| Generated PDF | Header export; no-original fallback | Existing /api/invoices/[id]/pdf |
| Payment allocations | Conditional right card with details and release | loadInvoicePaymentHistory reads committed allocations (includes split/manual); existing DELETE /api/payments |
| Reminder control | Right card switch; delivery block and history | Existing reminders_paused PATCH; failure retry POST unchanged |
| Customer/contact | Right card with registry link/mailto | Invoice snapshot fields; customer_id highlight |
| Audit | Left timeline, first two then full loaded history | Existing invoice_events (up to 100); no writes on view |

No structured invoice lines, customer phone, document size metadata, standalone
customer detail, document replacement/removal or arbitrary payment-splitting editor
exists in this flow. Do not invent them. Show an honest lines empty state; original
file preview provides actual blob size. Existing archive link manages related payment.
Invoice.source is input method, not proof of sending an email. Multi-rate invoices
are not described as a single VAT rate. Paid/cancelled invoices show no upcoming demand.

No API contracts, auth, RLS, database schema, OCR or financial settlement rules change.
All live queries retain organization/role checks. Release remains local only.

User follow-up: omit the invoice-lines card entirely. Put Customer and contact
in the main column immediately below the invoice summary instead.
