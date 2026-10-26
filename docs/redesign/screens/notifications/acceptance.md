# Notification system acceptance

Implemented the approved bell/dropdown layout, small unread dot, icon/type colors,
unread weight and accessible state, dividers, elapsed time, mark-one, mark-all, safe
navigation and /notifications history with all/unread filters and keyset pagination.
No extra avatar or speculative production notices were added.

Opening does not mark notifications read. Escape closes and restores focus; outside
click, viewport scroll/resize and a second bell click close safely. Internal scrolling
keeps the panel open. Important actions are keyboard/touch accessible. Loading uses a
small skeleton; empty and fetch/write errors have explicit recovery. A deleted target
is rendered without a broken link.

Validation:

- 150 Vitest tests across six relevant API, navigation, AppShell and dashboard files.
- Disposable PGlite database replays all migrations and executes notifications.sql:
  actual source transitions, duplicate delivery, personal receipts, two users,
  two companies (including a user switching legitimate memberships), forged IDs,
  restricted roles, direct authenticated and anonymous privileges, membership removal,
  actual service-role grants, concurrent arrival during mark-all, deleted targets,
  10,000-event history with non-overlapping bounded pages, and notification failure
  isolation from the invoice operation.
- Existing payment-assistance SQL runner: 13 suites passed, including reconciliation,
  money integrity, tenant guards, billing, support sessions and reminder queue.
- 10 browser scenarios: 320×568, 390×568, 768 and 1536px; closed/open/unread,
  mark-one/all, navigation to invoices/payments, independent users, write failure,
  read failure/retry, loading/empty, history/unread/pagination and compact action gap.
- 57 real dashboard/shared-shell browser cases passed, with an explicit assertion
  that the bell is adjacent to New Invoice and vertically centered.
- TypeScript and targeted ESLint passed. Production Next.js build verified.

Visual artifacts (synthetic fixture data only):

- docs/redesign/visual-validation/notifications/bell-closed.png
- docs/redesign/visual-validation/notifications/panel-1536.png
- docs/redesign/visual-validation/notifications/panel-390.png
- docs/redesign/visual-validation/notifications/panel-320.png
- docs/redesign/visual-validation/notifications/history-390.png
- docs/redesign/visual-validation/notifications/validation.json
- artifacts/dashboard-design/notifications-complete-chromium/

Compared with reference: 44px circular bell, small red dot, no numeric red badge,
410px anchored white panel, 15px rounding, subtle shadow, colored icon circles,
compact divided rows and footer link. The screenshot fixtures are never imported
by application code.

Release state: local implementation only. Migration
supabase/migrations/20261023210625_notification_system.sql was generated with CLI
and tested in isolation, not applied to the hosted database. No push, deployment or
external messages were performed. Apply this migration with the separately authorized
release before exposing the new client/API; otherwise the UI correctly reports an
unavailable notification source instead of showing fake content.

Approved event selection follow-up (2026-10-24): invoice overdue / fully paid,
unmatched or review payments, reminder sending/delivery failures, OCR/statement
failures, admin-only subscription/access changes. Successful reminder sends,
new customers, ordinary receipt/matching and paused reminders are silent.
Statement payment attention is grouped into one immutable summary per import,
computed after the import transaction; linked transactions do not duplicate it.
Follow-up validation: 33 notification API/helper tests, notification SQL including
noise exclusion, grouped count/deduplication and role restrictions, all 13 existing
SQL regression suites and all 10 notification browser scenarios passed.

Local UI preview: opt in with LOCAL_NOTIFICATIONS_PREVIEW=true in .env.local.
Only NODE_ENV=development and loopback requests enable it, after authentication
and the normal mutation origin/body guards. Five explicitly labeled synthetic
examples let the user inspect the bell, dropdown, history and read interactions
before the DB release. No notification RPC or remote write runs in this mode.
Read IDs persist in an HttpOnly SameSite=Strict localhost cookie scoped by
company/user, never in the hosted database. Set the flag to false to restore
the real feed. Production ignores the flag even if accidentally configured.

Overflow/navigation follow-up: notification rows explicitly reset inherited button
nowrap, text grid tracks use minmax(0,1fr), titles/messages wrap even without spaces,
and the scroll area cannot scroll horizontally. Four additional browser cases stress
long linked/unlinked rows at 320/390/768/1536px, including preview-note height and
viewport bounds; all 14 browser cases passed. Local invoice examples read up to 100
recent invoice IDs/numbers/statuses scoped to the authenticated company (read-only)
and link to real details, preferring the corresponding status. They remain clearly
labeled illustrative events, with list fallback when no invoice is available.
Production destinations already validate source entities within the company; deleted
entities retain informational history instead of a broken detail link.

Notification activation opens the exact safe destination immediately and closes the
popover. Saving a personal read receipt runs independently; failed or slow receipts
cannot block invoice/payment navigation, and failed writes preserve unread state.
Native modifier-click links remain available. All 14 browser scenarios, TypeScript
and targeted ESLint passed after this behavior change.
