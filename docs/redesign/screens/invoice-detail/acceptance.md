# Invoice detail acceptance

Implemented a presentation redesign on the existing SSR/SWR invoice detail route.
Shared shell, global search, profile, bell, sidebar and Esko remain unchanged.

Final user adjustments:
- Customer/contact replaces the invoice-lines panel beneath the main summary.
- Main exact gross total uses paid green, overdue red, pending amber, cancelled neutral.
  Partial invoices retain their underlying due-state color, with a partial badge and
  exact paid/remaining breakdown. Financial values are never taken from the mockup.

Desktop uses independent main/sidebar stacks; mobile orders summary, original document,
reminders, customer, allocated payments and history. Exact financial totals scale within
available width. All invoice/payment identifiers, email addresses and long names wrap
without horizontal page overflow. Main actions use existing modal/confirmation flows;
secondary edit/send/reopen/storno/date correction remain in the original action menu.

The document thumbnail renders page one of the authenticated original with the same
PDF.js loader/worker as DocumentPreview. Image originals use a private object URL.
Opening/downloading uses the existing authenticated route which signs at click time;
no public URL or expiring signed URL is embedded as the long-lived navigation target.
Missing documents expose the existing generated-PDF route, not a fabricated thumbnail.
Loading/error/retry states retain the safe open/download links. Canvas painting must
finish before screenshots, verified by data-ready and the actual rendered preview.

Reminder preference uses the original pause/resume PATCH. Paid/cancelled invoices
cannot trigger an active switch or show a next payment demand. Suppressed email
recipients show the existing delivery block. Real reminder history/retry remains in a
compact disclosure. Payment cards show committed allocation_amount (not whole bank
transaction amount), including manual, multiple and split payments. Release uses the
existing confirmation and DELETE endpoint, refreshes current detail/history/reminder
plan and invalidates workspace cache. No new matching algorithm or splitting action.

History displays actual invoice_events, first two and a control for the full loaded
history (existing loader cap 100). Source labels and event-specific details are retained.
Email sending now refreshes the detail audit after success. No events are written by
viewing this screen. Viewer gets document/read access but no mutations or operations
archive links. Backend organization checks, role rules and contracts are unchanged.

Validation:
- 64 relevant Vitest tests passed in 11 files, covering exact financial presentation,
  cache invalidation, payment flows, money-integrity guards, allocation history,
  audit events, reminder retries, PDF generation, role access and assignable payments.
  Updated a stale role-test expectation to include the already-supported notifications
  route; no access policy change was required by this redesign.
- 18 isolated Chromium browser scenarios with the real components and synthetic
  transport fixtures: 1536×1024, 1440×900, 1280×800, 390×844, 320×700; paid, partial,
  overdue, pending, cancelled, viewer, empty, long identifiers/large amounts; actual PDF
  thumbnail paint, document fetch failure/retry, pause/resume/failure recovery, manual
  settlement validation, selected bank partial assignment, allocation release with
  refreshed balance, download/customer/payment links and destructive confirmation.
- TypeScript, targeted ESLint and git diff --check passed.
- Isolated production Next.js webpack build passed (86 routes).

Screenshots: docs/redesign/visual-validation/invoice-detail/paid-{width}.png and
{scenario}-390.png. Compared the two-column hierarchy, headline/amount/badge, original
thumbnail, compact payment controls and timeline against the supplied reference.
Differences are intentional: contact replaces unsupported structured lines by request;
no duplicate topbar avatar, no extra payment button when paid, no scheduled demand for
paid invoices, no fabricated phone/items/transactions. Screenshots use test data only.

Local files only. No push, deployment, database migration, hosted data mutation,
customer email or real financial operation was performed as part of verification.

Closed desktop viewport follow-up: compact spacing for >=1280px-wide displays
with <=900px height, two latest audit events before the existing history expansion,
and a compact no-next-reminder message for paid/cancelled invoices. Nothing is
clipped to a forced height: expanded content and unusually large records can scroll.
The standard paid fixture with two allocations and a closed note fits without page
scrolling at 1536x1024, 1440x900 and 1280x800; full-page screenshot dimensions match
each viewport exactly. Existing 18 browser scenarios pass; mobile retains natural
vertical flow.

Viewport-fill follow-up: the detail's desktop main frame uses a viewport minimum
height, allocating remaining space to the financial summary/history and real
document preview. Independent columns finish 16px above the viewport bottom.
Taller desktops increase card/metadata/timeline typography; laptop spacing remains
compact and mobile remains in normal document flow. Expanded records may grow
naturally, without clipping or fixed-height content containers.
Before changing layout, captured exact search/import/new-invoice/bell bounding boxes
at 1536/1440/1280/390/320px. All final boxes match those baselines exactly; no
shared topbar/search/component CSS changed. All 18 browser scenarios pass, including
full viewport use, no document scroll in standard closed desktop cases, long text,
mobile, payment/reminder flows and real PDF rendering.

Document-card follow-up: original preview occupies the full card width above the
filename/size and full-width download control. The preview renderer is contained
without distorting the page aspect ratio. Desktop allocates available card space
to the preview, mobile uses a taller original; notebook payment spacing is compact
and redundant paid/cancelled copy is shortened. Existing viewport/topbar bounds
and all 18 browser scenarios pass; safe document open/download and retry unchanged.

Independent timeline follow-up: column minimum height derives from the viewport
and grid document offset, never from the other column's expanded height. The grid
aligns columns at the top; each can expand only for its own content. ResizeObserver
measurement is scheduled outside observer delivery and cleaned up on unmount.
Timeline titles and actor/date metadata wrap within the card with container-aware
type sizes; long e-mails never determine the card's intrinsic width. Timeline
content begins below its heading rather than being vertically stretched/centered.
Three additional browser checks at 1536/1280/390px expand twelve reminders and
assert invoice-history height stays unchanged (including long actor e-mail), then
close again. All 21 browser scenarios, TypeScript, targeted lint and diff checks pass.
Topbar position and standard closed-viewport checks remain unchanged.

Compact-history follow-up: audit is now a native details disclosure, closed by
default, with title, actual loaded event count and centered animated chevron.
Opening exposes all loaded audit entries in a bounded scroll region rather than
requiring a second "show all" control. Removed artificial growth of both audit and
summary in the main column; no large empty card replaces the removed audit space.
All audit details, responsive wrapping and independent reminder expansion remain.
All 21 browser cases plus TypeScript, targeted lint and diff checks passed.

Shared-topbar placement correction: removed detail-specific padding-top:8px and
compact padding-top:0 overrides. The detail now inherits the standard .content
spacing like the other workspace pages. Browser checks compare search/actions/bell
coordinates against a live standard AppFrame layout, rather than the older detail
baseline. All 21 cases pass and normal desktop content still fits the viewport.

Editing follow-up: the existing InvoiceForm sits in a 960px maximum-width wrapper
centered within the workspace content, including document note and submit actions.
While editing, the header back arrow is a local button that closes editing and
returns to the same invoice details without navigation or saving. Outside editing
it remains the existing link to the invoice list. Shared chrome placement unchanged.
Two additional real-form browser scenarios at 1536/390px measure horizontal centering
and assert back preserves URL, shows invoice info, and sends no mutation. All 23
browser cases, TypeScript, targeted lint and diff checks pass.
