"use client";

import { useState, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { apiFetch } from "@/lib/api-client";
import { RouterCacheInvalidator } from "@/components/router-cache-invalidator";

async function workspaceFetcher(key: string) {
  return apiFetch(key, { headers: { accept: "application/json" } });
}

export function WorkspaceDataProvider({ children }: { children: ReactNode }) {
  const [provider] = useState(() => () => new Map());

  return (
    <SWRConfig
      value={{
        provider,
        fetcher: workspaceFetcher,
        dedupingInterval: 10_000,
        keepPreviousData: true,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        shouldRetryOnError: false,
      }}
    >
      {/* Po každé změně dat zahodí stránky zapamatované v prohlížeči
          (experimental.staleTimes v next.config.js). */}
      <RouterCacheInvalidator />
      {children}
    </SWRConfig>
  );
}
