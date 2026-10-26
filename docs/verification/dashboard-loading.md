# Dashboard loading — 25 October 2026

The dashboard previously fetched invoice-count pages and four complete financial reports after server rendering. Each request performed authentication again. The report loader also fetched payment reconciliation statistics, although the dashboard only used monthly invoice amounts. The initial server loader downloaded the entire invoice cohort in sequential pages of 1,000 rows to compute totals in JavaScript.

The dashboard now receives one `dashboard_snapshot` RPC result containing its issue-date cohort totals, invoice counts, equal-length previous-period count, capped recent/upcoming lists, action counts, and monthly aggregates grouped by currency and invoice status. Graphs arrive with the server-rendered data. Each period change or refresh uses one `/api/dashboard` request; currency changes use the already loaded aggregates. The unfiltered dashboard API remains compatible with Esko through the existing `dashboard_summary` function.

No shared financial cache or authentication bypass was added. Workspace invalidation still refreshes the `/api/dashboard` SWR key after mutations. Switching periods hides the previous period's values. Transient network, timeout, rate-limit and server errors have at most two automatic retries; permission errors do not retry. Background refresh failures retain the previous successful snapshot with an error indication.

## Database and rollout

The additive function was applied to the linked Supabase project. The local migration was initially generated with `supabase migration new dashboard_snapshot`, then its filename was aligned with the version assigned by the migration API: `20261025141958_dashboard_snapshot.sql`. It changes no financial records. It is security invoker, only executable by `service_role`, and checks actor membership, allowed role and support-session expiry. Application changes are local; no application deployment or git push was performed.

## Verification

- 93 targeted tests passed across the dashboard client, API, period calculations, summary/presentation helpers, server loader, workspace performance checks and existing report loader/API contracts.
- `node scripts/test-dashboard-db.mjs` passed against disposable PostgreSQL with all 56 migrations replayed. It checks 1,001 synthetic invoices; inclusive dates and empty periods; prior-period counts; currencies; partial receipts; cancelled invoices; monthly equivalence to the full report for each currency/status; preview limits; payment-review and unexpired OCR counts; tenant isolation; viewer access; expired support; and execute permissions.
- Read-only checks on the linked database confirmed invoice counts and eight chart comparisons against the original report RPC. The service role has the required read privileges; browser and anonymous roles cannot execute the new RPC. Security/performance advisors did not identify the new function.
- A single live EXPLAIN ANALYZE of the snapshot call completed in approximately 19.5 ms, including fixture-member selection. This is a database-only sample, not a measured browser speedup or latency guarantee.
- Real React/AppShell browser fixtures passed at 320, 360, 390, 430, 600, 767, 768 and 1440 px with normal and long-content data (16 cases). These fixtures do not replace authenticated production end-to-end testing.
- Repository lint, typecheck, migration validation and isolated production build passed. The build used `.cache/invoices-build` to preserve the running development build.
- The full repository test run had 2,078 passes and 12 failures in eight files. Failures concern existing UI/source assertions and error-migration accounting: customer invoice links/layout, OCR stop control, bank matching presentation/filter controls, shared topbar role condition, reminder money formatting, and the count of routes without structured errors. None is a failed new snapshot test. The complete run preceded the addition of eight dashboard API tests; those passed in the final targeted run. These unrelated failures were left unchanged.

Reproduce the database regression with `node scripts/test-dashboard-db.mjs`. It requires the existing PGlite tool installation in `.cache/reconciliation-tools`; it never uses production credentials.
