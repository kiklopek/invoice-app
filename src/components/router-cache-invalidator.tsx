"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isDataMutation } from "@/lib/router-cache";

/**
 * Po každé úspěšné změně dat přes /api/* zahodí stránky zapamatované
 * v prohlížeči (router.refresh() v Next.js zneplatní celou klientskou cache,
 * ne jen aktuální stránku). Díky tomu může být zapnuté
 * experimental.staleTimes a přepínání mezi stránkami je okamžité, aniž by
 * se po úhradě nebo smazání faktury ukázala stará čísla.
 *
 * Sleduje se fetch v celém workspace, protože změny posílá jak apiFetch,
 * tak přímý fetch -- jedno místo místo padesáti.
 */
export function RouterCacheInvalidator() {
  const router = useRouter();
  useEffect(() => {
    const original = window.fetch;
    let timer: number | undefined;
    const observed: typeof window.fetch = async (input, init) => {
      const response = await original(input, init);
      try {
        if (isDataMutation(input, init, response, window.location.origin)) {
          // Několik změn těsně po sobě = jedno obnovení.
          window.clearTimeout(timer);
          timer = window.setTimeout(() => router.refresh(), 150);
        }
      } catch {
        // Sledování nesmí rozbít samotný požadavek.
      }
      return response;
    };
    window.fetch = observed;
    return () => {
      window.clearTimeout(timer);
      if (window.fetch === observed) window.fetch = original;
    };
  }, [router]);
  return null;
}
