import { describe, expect, it } from "vitest";
import { reconciliationError } from "./reconciliation-errors";

// Tenhle modul překládá chyby ze zaúčtovací funkce na věty, které uvidí
// účetní při potvrzování bankovního výpisu -- tedy přesně ve chvíli, kdy
// se zapisují peníze na faktury. Neměl test, přestože je to poslední
// vrstva mezi databázovou hláškou a člověkem.

describe("reconciliationError", () => {
  it("recognises every documented failure of the booking function", () => {
    // Seznam odpovídá stavům, které reconcile_bank_statement umí vrátit.
    const cases: Array<[string, string]> = [
      ["revision_conflict", "Import mezitím změnil jiný uživatel. Načtěte aktuální stav."],
      ["invoice_balance_changed", "Zůstatek faktury se změnil nebo jej využívá jiná platba. Upravte přiřazení."],
      ["invoice_overallocated", "Součet přiřazení z více plateb překračuje zbývající dluh faktury."],
      ["possible_duplicate", "Platba už může být evidovaná. Zkontrolujte duplicitu."],
      ["duplicate_external_id", "Platba se stejným identifikátorem už je evidovaná."],
      ["invalid_allocation_target", "Vybraná faktura už není otevřená nebo má jinou měnu."],
      ["proposal_changed", "Podklady automatického návrhu se změnily. Potvrďte přiřazení ručně."],
      ["account_mismatch_acknowledgement_required", "Potvrďte nesoulad bankovního účtu."],
      ["statement_import_not_committable", "Import není ve stavu umožňujícím potvrzení."],
      ["statement_entry_not_booked", "Tato položka není zaúčtovaná, není co uvolnit."],
      ["statement_entry_not_found", "Položka importu už neexistuje. Načtěte aktuální stav."],
      ["insufficient_payment_import_permission", "Nemáte oprávnění měnit zaúčtované platby."],
    ];
    for (const [code, expected] of cases) {
      expect(reconciliationError(code), code).toEqual({ code, error: expected });
    }
  });

  it("finds the code inside a longer database message", () => {
    // Postgres hlášku obaluje kontextem, takže přesná shoda by selhala.
    const result = reconciliationError('ERROR: revision_conflict CONTEXT: PL/pgSQL function reconcile_bank_statement');
    expect(result.code).toBe("revision_conflict");
    expect(result.error).toContain("Načtěte aktuální stav");
  });

  it("falls back to a usable Czech sentence for an unknown failure", () => {
    // Nikdy nesmí uživateli propadnout surová anglická hláška z databáze.
    const result = reconciliationError("ERROR: deadlock detected on relation bank_payments");
    expect(result.code).toBe("entry_commit_failed");
    expect(result.error).toContain("nepodařilo zaúčtovat");
    expect(result.error).not.toContain("deadlock");
  });

  it("never returns an empty message, whatever it is given", () => {
    for (const message of ["", " ", "null", "undefined"]) {
      const result = reconciliationError(message);
      expect(result.error.length, message).toBeGreaterThan(10);
      expect(result.code, message).toBeTruthy();
    }
  });

  it("tells the user what to do, not just what went wrong", () => {
    // Účetní stojí uprostřed potvrzování výpisu; samotné konstatování
    // chyby ji nikam neposune.
    const actionable = [
      "revision_conflict",
      "invoice_balance_changed",
      "proposal_changed",
      "statement_entry_not_found",
    ];
    for (const code of actionable) {
      const { error } = reconciliationError(code);
      expect(error, code).toMatch(/Načtěte|Upravte|Potvrďte|Zkontrolujte/);
    }
  });
});
