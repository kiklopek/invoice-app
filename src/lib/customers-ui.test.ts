import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

const customersPage = source(
  "src/app/(workspace)/customers/customers-client.tsx",
);
const css = source("src/app/minimal.css");

describe("customers page presentation", () => {
  it("uses the shared visual hierarchy and a compact customer overview", () => {
    expect(customersPage).toContain('className="section-header customers-hero"');
    expect(customersPage).toContain('className="page-panel customers-toolbar"');
    expect(customersPage).toContain("Kontakty, fakturace a stav pohledávek");
  });

  it("turns the customer table into readable cards on narrow screens", () => {
    expect(css).toContain(".customers-list-table thead { display: none; }");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(css).toContain(".customers-list-table td::before");
    expect(css).toContain(".customers-list-table .customer-identity-cell");
  });
});
