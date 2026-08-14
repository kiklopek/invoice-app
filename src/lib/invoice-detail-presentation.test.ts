import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  join(process.cwd(), "src", "app", "invoices", "[id]", "page.tsx"),
  "utf8",
);
const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

describe("invoice detail amount summary", () => {
  it("shows the net amount as the primary value and gross amount as secondary", () => {
    expect(page).toContain("Částka faktury bez DPH");
    expect(page).toContain("money(Number(invoice.amount_without_vat), invoice.currency)");
    expect(page).toContain('className="invoice-hero-gross"');
    expect(page).toContain("Částka s DPH:");
    expect(page).toContain("money(Number(invoice.amount), invoice.currency)");
    expect(css).toContain(".invoice-hero-gross");
  });
});
