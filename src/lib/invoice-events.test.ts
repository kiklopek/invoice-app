import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { INVOICE_EVENT_TYPES } from "@/types/invoice";

// Aktivita faktury má dva nezávislé seznamy povolených událostí: CHECK
// constraint v databázi a výčet v TypeScriptu. Když se rozejdou, chyba se
// neprojeví při překladu, ale až za běhu -- buď databáze zápis odmítne, nebo
// se v aktivitě vykreslí řádek bez popisku. Tenhle test je drží u sebe.

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** Poslední migrace, která výčet definuje, je ta platná -- stejně jako v databázi. */
function allowedEventTypesInDatabase(): string[] {
  const files = readdirSync(MIGRATIONS).filter(name => name.endsWith(".sql")).sort();
  let latest: string[] | null = null;
  for (const file of files) {
    const source = readFileSync(join(MIGRATIONS, file), "utf8");
    // Jen constraint tabulky invoice_events; ostatní tabulky mají vlastní
    // event_type se zcela jinými hodnotami.
    const scope = source.includes("invoice_events") ? source : "";
    if (!scope) continue;
    const matches = [...scope.matchAll(/event_type in \(([^)]*)\)/g)];
    for (const match of matches) {
      const values = [...match[1].matchAll(/'([a-z_.]+)'/g)].map(value => value[1]);
      // Rozliší constraint faktur od webhooků a členů organizace.
      if (values.includes("created") && values.includes("payment_changed")) latest = values;
    }
  }
  if (!latest) throw new Error("V migracích chybí CHECK constraint pro invoice_events.event_type");
  return latest;
}

describe("povolené události faktury", () => {
  it("databáze a TypeScript znají stejný výčet", () => {
    expect([...allowedEventTypesInDatabase()].sort()).toEqual([...INVOICE_EVENT_TYPES].sort());
  });

  it("ruční odeslání faktury e-mailem má vlastní událost", () => {
    // Bez ní by v aktivitě nebylo vidět, že odběratel už fakturu dostal,
    // a účetní by ji mohla poslat podruhé.
    expect(INVOICE_EVENT_TYPES).toContain("emailed");
    expect(allowedEventTypesInDatabase()).toContain("emailed");
  });

  it("nepatří do reminder_log, který plánuje automatické upomínky", () => {
    // reminder_log má unique (invoice_id, stage, scheduled_for) a plánovač
    // podle něj rozhoduje, zda fázi už vyřídil. Ruční záznam by tam obsadil
    // slot naplánované upomínky a ta by tiše neodešla.
    const send = readFileSync(join(process.cwd(), "src", "app", "api", "invoices", "[id]", "send", "route.ts"), "utf8");
    expect(send).toContain("invoice_events");
    expect(send).not.toContain("reminder_log");
  });
});
