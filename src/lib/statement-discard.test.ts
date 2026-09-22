import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { reconciliationError } from "./reconciliation-errors";

// Zahození nahraného výpisu je měkké: import dostane stav 'discarded' a
// zůstane v archivu. Tvrdé smazání by kaskádou odstranilo položky výpisu,
// ale bank_statement_entries.bank_payment_id je 'on delete set null', takže
// už zaúčtované platby by přežily bez vazby na svůj původ. U účetního
// software je zničená auditní stopa horší než zaseknutý stav "Ke kontrole".

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260922100000_discard_bank_statement_import.sql"),
  "utf8",
);

describe("zahození bankovního výpisu", () => {
  it("odmítne výpis, ze kterého už vznikly platby", () => {
    // Tohle je celý důvod, proč funkce existuje místo prostého DELETE.
    expect(migration).toContain("statement_import_has_booked_payments");
    expect(migration).toMatch(/bank_payment_id is not null/);
  });

  it("nikdy nemaže, jen mění stav", () => {
    expect(migration).not.toMatch(/delete\s+from\s+public\.bank_statement_imports/i);
    expect(migration).toContain("status='discarded'");
  });

  it("zahodit smí jen účetní a správce", () => {
    expect(migration).toContain("role in ('accounting','admin')");
    expect(migration).toContain("insufficient_payment_import_permission");
  });

  it("hlídá revizi, takže dva lidé nezahodí rozpracovaný výpis pod sebou", () => {
    expect(migration).toContain("revision_conflict");
  });

  it("opakované zahození není chyba", () => {
    // Tlačítko jde zmáčknout dvakrát; druhé volání musí projít stejně.
    expect(migration).toMatch(/status='discarded' then[\s\S]{0,200}'idempotent', true/);
  });

  it("zahozený výpis nemůže obživnout automatickým zaúčtováním", () => {
    // reconcile_bank_statement() pouští dál jen 'review'; kdyby tahle
    // podmínka zmizela, worker by zahozený výpis zase zpracoval.
    const reconcile = readFileSync(
      join(process.cwd(), "supabase", "migrations", "20260918111705_robust_reconciliation.sql"),
      "utf8",
    );
    expect(reconcile).toContain("if s.status<>'review' then raise exception 'statement_import_not_committable'");
    expect(reconcile).toMatch(/bank_statement_imports i where status='review'/);
  });

  it("nový stav je povolený i v CHECK constraintu", () => {
    // Bez toho by funkce spadla až za běhu při zápisu.
    expect(migration).toMatch(/check \(status in \([^)]*'discarded'\)\)/);
  });

  it("zahození se nedá zapsat bez toho, kdo ho provedl", () => {
    expect(migration).toContain("bank_statement_imports_discard_state_check");
    expect(migration).toMatch(/discarded_at is not null and discarded_by is not null/);
  });
});

describe("hlášky o zahození", () => {
  it("zaúčtované platby vysvětlí celou větou, ne kódem", () => {
    const problem = reconciliationError("statement_import_has_booked_payments");
    expect(problem.code).toBe("statement_import_has_booked_payments");
    expect(problem.error).toContain("zaúčtované platby");
    // Uživateli musí říct, co s tím má dělat.
    expect(problem.error).toContain("uvolněte");
  });

  it("nevhodný stav a neexistující import mají vlastní hlášku", () => {
    expect(reconciliationError("statement_import_not_discardable").code).toBe("statement_import_not_discardable");
    expect(reconciliationError("statement_import_not_found").code).toBe("statement_import_not_found");
  });
});

describe("routa pro zahození", () => {
  const route = readFileSync(
    join(process.cwd(), "src", "app", "api", "payments", "imports", "[id]", "discard", "route.ts"),
    "utf8",
  );

  it("volá databázovou funkci, nemaže řádky sama", () => {
    expect(route).toContain("discard_bank_statement_import");
    expect(route).not.toContain(".delete(");
  });

  it("konflikt se skutečností vrací 409, ne 400", () => {
    // 400 by uživatele vedlo k opakování téhož požadavku; 409 znamená
    // "načti aktuální stav".
    expect(route).toMatch(/has_booked_payments[\s\S]{0,120}409/);
  });
});

describe("migrace zůstávají konzistentní", () => {
  it("žádná pozdější migrace zahození nepřepisuje", () => {
    // Kdyby někdo funkci předefinoval, tenhle test na to upozorní dřív,
    // než se tu začnou ověřovat neplatná tvrzení.
    const dir = join(process.cwd(), "supabase", "migrations");
    const definitions = readdirSync(dir)
      .filter(name => name.endsWith(".sql"))
      .filter(name => readFileSync(join(dir, name), "utf8").includes("function public.discard_bank_statement_import"));
    expect(definitions).toEqual(["20260922100000_discard_bank_statement_import.sql"]);
  });
});
