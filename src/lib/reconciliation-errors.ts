export function reconciliationError(message: string) {
  const messages: Record<string, string> = {
    revision_conflict: "Import mezitím změnil jiný uživatel. Načtěte aktuální stav.",
    invoice_balance_changed: "Zůstatek faktury se změnil nebo jej využívá jiná platba. Upravte přiřazení.",
    invoice_overallocated: "Součet přiřazení z více plateb překračuje zbývající dluh faktury.",
    possible_duplicate: "Platba už může být evidovaná. Zkontrolujte duplicitu.",
    duplicate_external_id: "Platba se stejným identifikátorem už je evidovaná.",
    invalid_allocation_totals: "Součet přiřazení neodpovídá platbě. Zkontrolujte částky nebo potvrďte částečné přiřazení.",
    invalid_allocation_target: "Vybraná faktura už není otevřená nebo má jinou měnu.",
    proposal_changed: "Podklady automatického návrhu se změnily. Potvrďte přiřazení ručně.",
    account_mismatch_acknowledgement_required: "Potvrďte nesoulad bankovního účtu.",
    statement_import_not_committable: "Import není ve stavu umožňujícím potvrzení.",
    statement_entry_not_booked: "Tato položka není zaúčtovaná, není co uvolnit.",
    statement_entry_not_found: "Položka importu už neexistuje. Načtěte aktuální stav.",
    insufficient_payment_import_permission: "Nemáte oprávnění měnit zaúčtované platby.",
  };
  const code = Object.keys(messages).find(key => message.includes(key)) ?? "entry_commit_failed";
  return { code, error: messages[code] ?? "Položku se nepodařilo zaúčtovat. Ostatní výsledky ověřte v aktuálním stavu importu." };
}
