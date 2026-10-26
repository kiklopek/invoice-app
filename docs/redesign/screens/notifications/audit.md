# Notification audit and architecture

Existing application has invoice_events (immutable invoice state audit), reminder_log,
bank_payments, invoice_uploads OCR status, subscriptions and organization_member_events.
Customers are durable registry records created through the existing invoice workflow.
There was no persisted notification feed or per-user read state. AppShell already has a
profile in the sidebar; no duplicate avatar was added.

The implementation reuses these real writes. It adds notification_events (one event per
company/stable source key) and notification_reads (one receipt per user/company/event).
No fanout per member, no separate queue, Realtime subscription, bank polling or browser
creation of business events is introduced. Existing cron's overdue state transition
naturally emits through invoice_events; rendering a dashboard cannot create notices.

Sources:

| Source | Events | Audience | Destination |
|---|---|---|---|
| invoice_events | overdue once per invoice/due date; fully paid | all financial readers | existing invoice detail |
| bank_payments | persisted unmatched/review transactions, outside grouped statements | accounting/admin | existing payment archive with highlight |
| reminder_log | failed sending, failed delivery | accounting/admin | invoice detail |
| invoice_uploads | OCR failure | accounting/admin | invoice import |
| bank_statement_imports | failed posting; one summary of payments needing review per statement | accounting/admin | payment matching |
| subscriptions | transition to past_due/unpaid/paused | admin | subscription page |
| organization_member_events | actual access changes | admin | company settings |

There is no fabricated “unpaid reminder” or speculative incoming bank transaction.
Previewing a GPC statement does not create an incoming-payment notification.
No historical backfill occurs on migration: notifications start with actual new events.
An insert failure is contained by the private trigger and emits a generic warning;
existing invoice, payment and reminder state must not be rolled back by a UI notification.
No provider error diagnostics, tokens, full bank accounts or user metadata claims are
stored as message text.

GET /api/notifications calls an invoker RPC restricted to service_role. Actor and current
company come exclusively from getRequestIdentity, and SQL rechecks live membership,
role and support expiry. Objects are checked in that company before returning a target.
Missing/deleted targets remain informational. RLS uses existing private membership
helpers; clients can only select their allowed events and their own receipts, never
create or edit event content or call the service-only RPCs.

PATCH /api/notifications checks same origin, validates IDs/snapshot time, then inserts
idempotent personal receipts. Foreign and role-restricted IDs are rejected atomically.
“Mark all” uses the server feed's timestamp cutoff, so concurrent arrivals stay unread.
Only confirmed writes update local caches; a subsequent refresh failure does not undo
success or stop related-object navigation.

SWR shares feeds within the existing provider keyed by organization/user/role. It polls
at 60s while visible/online, refreshes on focus (15s throttle) and opening (15s throttle),
and refreshes through the existing workspace invalidation after data mutations.
Pagination uses the (created_at,id) keyset; feed payload max50, dropdown8, history30.
The red indicator is only unread_count>0 and never a fabricated placeholder.

Shared header now groups invoice actions and bell. Removed an obsolete 120px dashboard
reservation and the actions' vertical offset. Mobile keeps the bell beside search and
the existing invoice buttons on their own row. A viewport-bounded scroll area preserves
header/footer and touch targets at 320×568. The profile stays in the sidebar.

Reference guidance consulted:
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Postgres triggers](https://supabase.com/docs/guides/database/postgres/triggers).
No new feature depends on affected extensions in the current PostgreSQL maintenance
release notes. Next.js client and CSS guides were read locally before implementation.

Approved event policy: do not emit routine edits, paused reminders, newly created
customers, successful reminder delivery/sending, routine payment receipts or successful
matching. Fully settled invoices retain their own confirmation. Billing/access notices
are admin-only. Read receipts acknowledge viewing, never resolve a business issue.
Statement summaries are immutable snapshots of rows requiring attention at the end of
the import transaction; safe and unrelated rows are excluded, already linked payment
rows are not announced individually. Reopening/updating the same import does not
repeat a read notice. Failures remain distinct from the review summary.
