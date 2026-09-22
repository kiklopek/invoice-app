"use client";

import { useSWRConfig } from "swr";

// Celý workspace sdílí jednu SWR cache (viz WorkspaceDataProvider) -- ale
// fallbackData ze serveru se ignoruje, pokud cache pro daný klíč už něco
// obsahuje. Výsledek: po smazání faktury nebo změně jejího stavu na jedné
// stránce zůstávaly Dashboard, Reporty a další už navštívené stránky na
// starých číslech, dokud se okno neztratilo a znovu nezískalo fokus
// (revalidateOnFocus je jediné, co je tehdy obnovilo).
//
// POZOR na past, na kterou se dá snadno narazit znovu: globální mutate()
// naimportované přímo z "swr" pracuje s výchozí cache, ne s tou vlastní,
// kterou WorkspaceDataProvider nastavuje přes SWRConfig provider -- proti
// ní tiše nedělá nic (ověřeno testem v workspace-cache.test.ts). Funkční
// je jen mutate vrácené hookem useSWRConfig(), který je na kontext vázaný.
//
// Volá se po každé mutaci, která mění peníze na faktuře -- smazání, změna
// stavu, zaznamenání úhrady. Obnoví data na aktuálně připojených stránkách
// a zahodí cache těch nepřipojených, takže příští návštěva natáhne čerstvá
// data místo starého fallbacku.
export function useInvalidateWorkspaceData() {
  const { mutate } = useSWRConfig();
  return () => mutate(
    (key) => typeof key === "string" && key.startsWith("/api/"),
    undefined,
    { revalidate: true },
  );
}
