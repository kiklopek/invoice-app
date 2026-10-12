import { useState } from "react";
import { useSWRConfig } from "swr";

type CacheLike = { get(key: string): { data?: unknown } | undefined };

/** Drží sdílená SWR cache pro tento klíč data z dřívější návštěvy? */
export function hasCachedData(cache: CacheLike, key: string | null) {
  return key !== null && cache.get(key)?.data !== undefined;
}

/**
 * Má se stránka s daty ze serveru (fallbackData) po připojení znovu načíst?
 *
 * Při první návštěvě ne: v cache nic není, data ze serveru jsou čerstvá a
 * druhý dotaz by jen zdvojil práci serveru i databáze. Při návratu ano:
 * sdílená cache přežívá navigaci a má přednost před fallbackData, takže by
 * jinak ukázala stav z dřívější návštěvy. Rozhoduje se jednou, při připojení.
 */
export function useRevalidateOnRevisit(key: string | null) {
  const { cache } = useSWRConfig();
  const [revisit] = useState(() => hasCachedData(cache, key));
  return revisit;
}
