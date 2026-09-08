"use client";

import { useState, type ReactNode } from "react";
import { SWRConfig } from "swr";

async function workspaceFetcher(key: string) {
  const response = await fetch(key, { headers: { accept: "application/json" } });
  const data = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(data?.error || "Data se nepodařilo načíst.");
  return data;
}

export function WorkspaceDataProvider({ children }: { children: ReactNode }) {
  const [provider] = useState(() => () => new Map());

  return (
    <SWRConfig value={{
      provider,
      fetcher: workspaceFetcher,
      dedupingInterval: 10_000,
      keepPreviousData: true,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      shouldRetryOnError: false,
    }}>
      {children}
    </SWRConfig>
  );
}
