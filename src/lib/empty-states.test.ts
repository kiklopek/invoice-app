import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("stránka nenalezena", () => {
  // Dřív neexistovala vůbec: neplatná adresa nebo neexistující ID faktury
  // skončilo na výchozí anglické stránce Next.js bez layoutu aplikace,
  // což vypadá jako pád, ne jako překlep v odkazu.
  it("exists and is written for a Czech user", () => {
    expect(existsSync(join(process.cwd(), "src/app/not-found.tsx"))).toBe(true);
    const source = read("src/app/not-found.tsx");
    expect(source).toContain("Stránka nenalezena");
    // Nabízí cestu ven, ne jen konstatování.
    expect(source).toContain('href="/dashboard"');
    expect(source).toContain('href="/invoices"');
  });

  it("is what a missing invoice actually reaches", () => {
    // Loader hlásí 404, ale dřív to spadlo do obecné chybové hranice.
    const page = read("src/app/(workspace)/invoices/[id]/page.tsx");
    expect(page).toContain("notFound()");
    expect(page).toContain("cause.status === 404");
  });
});

describe("prázdný seznam faktur", () => {
  const invoices = () => read("src/app/(workspace)/invoices/invoices-client.tsx");

  // Nová organizace dostala "Tomuto filtru neodpovídá žádná faktura",
  // i když žádný filtr nastavený nebyl. Hláška lhala a neporadila nic.
  it("tells a new organization what to do, instead of blaming a filter", () => {
    const source = invoices();
    expect(source).toContain("Zatím tu není žádná faktura");
    expect(source).toContain("hasActiveFilter");
  });

  it("offers to clear the filters when a filter really is the reason", () => {
    const source = invoices();
    expect(source).toContain("Zrušit filtry");
    expect(source).toContain("function clearFilters(");
  });

  it("clears every filter, not just the obvious ones", () => {
    const source = invoices();
    const body = source.slice(source.indexOf("function clearFilters("), source.indexOf("function clearFilters(") + 500);
    for (const setter of ["setQuery", "setStatus", "setCurrency", "setFrom", "setTo", "setDueFrom", "setDueTo", "setAmountMin", "setAmountMax", "setPaymentState", "setBankMatch"]) {
      expect(body, setter).toContain(setter);
    }
  });
});
