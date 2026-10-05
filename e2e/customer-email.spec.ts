import { expect, test } from "@playwright/test";
import { requireWorkspaceSession } from "./session";

test("úprava kontaktu zákazníka: zrušení, chyba a uložení e-mailu", async ({ page }) => {
  const id = "11111111-1111-4111-8111-111111111111";
  let email = "old@example.cz";
  let fail = true;
  const requests: unknown[] = [];
  await page.route("**/api/customers", (route) => route.fulfill({ json: {
    can_manage: true,
    customers: [{ id, name: "Test kontaktu", ico: "87654321", email, phone: "123", total_invoiced: 100, outstanding: 100, overdue_amount: 0, invoice_count: 1 }],
  } }));
  // No actual customer, invoice or email is modified by this browser test.
  await page.route(`**/api/customers/${id}`, async (route) => {
    requests.push(route.request().postDataJSON());
    if (fail) return route.fulfill({ status: 400, json: { error: "Testovací chyba kontaktu." } });
    email = route.request().postDataJSON().email;
    return route.fulfill({ json: { customer: { id, email }, updated_invoice_count: 2 } });
  });
  await page.goto("/customers");
  if (await requireWorkspaceSession(page, "úprava e-mailu zákazníka")) return;
  const edit = page.getByRole("button", { name: "Upravit e-mail zákazníka Test kontaktu", exact: true });
  await expect(edit).toBeVisible();
  await edit.click();
  const input = page.getByRole("textbox", { name: "E-mail zákazníka Test kontaktu", exact: true });
  await input.fill("discard@example.cz");
  await page.getByRole("button", { name: "Zrušit úpravu e-mailu", exact: true }).click();
  await expect(edit).toContainText("old@example.cz");
  expect(requests).toHaveLength(0);
  await edit.click();
  await expect(input).toHaveValue("old@example.cz");
  await input.fill("adam@hlavica.cz");
  await expect(page.getByText("Změní se i příjemce upomínek u neuhrazených faktur.")).toBeVisible();
  await page.getByRole("button", { name: "Uložit e-mail", exact: true }).click();
  await expect(page.locator(".customer-email-form").getByRole("alert")).toHaveText("Testovací chyba kontaktu.");
  await expect(input).toHaveValue("adam@hlavica.cz");
  fail = false;
  await input.press("Enter");
  await expect(edit).toContainText("adam@hlavica.cz");
  await expect(page.getByRole("status")).toContainText("Aktualizované neuhrazené faktury: 2");
  await page.reload();
  await expect(edit).toContainText("adam@hlavica.cz");
  expect(requests).toEqual([{ email: "adam@hlavica.cz" }, { email: "adam@hlavica.cz" }]);
});

test("čtenář nemůže upravit kontakt zákazníka", async ({ page }) => {
  await page.route("**/api/customers", (route) => route.fulfill({ json: {
    can_manage: false,
    customers: [{ id: "11111111-1111-4111-8111-111111111111", name: "Test čtenáře", email: "customer@example.cz", total_invoiced: 0, outstanding: 0, overdue_amount: 0, invoice_count: 0 }],
  } }));
  await page.goto("/customers");
  if (await requireWorkspaceSession(page, "oprávnění kontaktu zákazníka")) return;
  await expect(page.getByRole("button", { name: "Upravit e-mail zákazníka Test čtenáře", exact: true })).toBeDisabled();
});
