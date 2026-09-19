import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const detail = () => source("src/app/(workspace)/invoices/[id]/invoice-detail-client.tsx");
const customers = () => source("src/app/(workspace)/customers/customers-client.tsx");

// "Odběratel" (who pays THIS invoice) and "Zákazník" (the durable directory
// entry, learned across invoices) stay two different words for two different
// concepts by design -- see the memory this session is built from. What was
// missing was any way to move between the two screens. These tests pin that
// link in both directions so a future edit can't quietly drop one side.
describe("odběratel na faktuře ↔ zákazník v adresáři", () => {
  it("links an invoice's counterparty to its customer record when one is known", () => {
    const source = detail();
    expect(source).toContain("invoice.customer_id");
    expect(source).toContain('href={`/customers?highlight=${invoice.customer_id}`}');
  });

  it("explains why there is no link, instead of just omitting it silently", () => {
    expect(detail()).toContain("Toto IČO nemá platný záznam v adresáři Zákazníků");
  });

  it("links a customer row to their invoices, filtered by name", () => {
    const source = customers();
    expect(source).toContain("href={`/invoices?q=${encodeURIComponent(customer.name)}`}");
  });

  it("scrolls to and highlights the customer arrived at via ?highlight=, without a Suspense-requiring hook", () => {
    const source = customers();
    // useSearchParams forces a Suspense boundary this plain server-rendered
    // page does not have -- reading window.location.search sidesteps that
    // entirely, same idiom invoices-client.tsx already uses.
    expect(source).not.toContain('from "next/navigation"');
    expect(source).toContain("new URLSearchParams(window.location.search).get(\"highlight\")");
    expect(source).toContain("scrollIntoView");
  });
});
