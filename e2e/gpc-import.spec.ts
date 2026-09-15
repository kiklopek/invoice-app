import { expect, test } from "@playwright/test";

const importId = "11111111-1111-4111-8111-111111111111";
const entryId = "22222222-2222-4222-8222-222222222222";
const invoiceId = "33333333-3333-4333-8333-333333333333";
const fingerprint = "a".repeat(64);
const invoice = {
  id: invoiceId,
  invoice_number: "FV-GPC-001",
  counterparty_name: "Testovací odběratel",
  amount: 123.45,
  paid_amount: 0,
  currency: "CZK",
  variable_symbol: "42",
};
const entry = {
  id: entryId,
  line_number: 2,
  fingerprint,
  disposition: "accepted",
  reason: null,
  amount: 123.45,
  currency: "CZK",
  booked_on: "2026-09-14",
  variable_symbol: "42",
  counterparty_name: "Testovací odběratel",
  proposal_kind: "exact",
  proposal_confidence: "safe",
  proposal_reason: "Jedinečný VS, měna a přesná zbývající částka.",
  proposed_invoice_ids: [invoiceId],
};

test("GPC preview can be reviewed and committed without rendering an unbounded list", async ({
  page,
}) => {
  await page.route(/\/api\/payments$/, async (route) => {
    await route.fulfill({
      json: {
        payments: [],
        open_invoices: [invoice],
        can_manage: true,
        gpc_enabled: true,
      },
    });
  });
  await page.route(/\/api\/payments\/invoice-candidates/, async (route) => {
    await route.fulfill({ json: { invoices: [invoice], total: 1 } });
  });
  await page.route(/\/api\/payments\/imports$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { imports: [] } });
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        import: {
          id: importId,
          revision: 1,
          duplicate: false,
          status: "review",
        },
        account_mismatch: false,
        totals: { accepted: 1, ignored: 0, errors: 0 },
        entries: [entry],
        proposal_invoices: [invoice],
        total_entries: 1,
        request_id: "e2e-request",
      },
    });
  });
  await page.route(
    new RegExp(`/api/payments/imports/${importId}(?:\\?page=\\d+)?$`),
    async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: {
            entries: [entry],
            allocations: [
              {
                statement_entry_id: entryId,
                invoice_id: invoiceId,
                is_manual_partial: false,
              },
            ],
            proposal_invoices: [invoice],
            total: 1,
          },
        });
        return;
      }
      await route.fulfill({ json: { revision: 2 } });
    },
  );
  await page.route(
    new RegExp(`/api/payments/imports/${importId}/commit$`),
    async (route) => {
      await route.fulfill({ json: { imported: 1, matched: 1 } });
    },
  );

  await page.goto("/invoices/payments");
  test.skip(
    page.url().includes("/login"),
    "Requires an authenticated staging session",
  );
  await page.locator('input[type="file"][accept^=".gpc"]').setInputFiles({
    name: "statement.gpc",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("mocked-gpc"),
  });
  await expect(page.getByText(/VS 42 · Přesná shoda/)).toBeVisible();
  await expect(page.locator(".gpc-entry-list .gpc-entry")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Uložit kontrolu a potvrdit import" })
    .click();
  await expect(page.getByText(/Import je dokončený: 1 plateb/)).toBeVisible({
    timeout: 15_000,
  });
});
