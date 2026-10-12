import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

type Stage = "claims" | "auth_user" | "membership" | "auth_http" | "db" | "storage";
type Span = { duration: number; calls: number };
const requestSpans = new AsyncLocalStorage<Map<Stage, Span>>();

/** Only fixed stage names and durations are retained; never URLs or payloads. */
export async function measureServerOperation<T>(stage: Stage, operation: () => PromiseLike<T>): Promise<T> {
  const spans = requestSpans.getStore();
  if (!spans) return operation();
  const started = performance.now();
  try {
    return await operation();
  } finally {
    const previous = spans.get(stage);
    spans.set(stage, { duration: (previous?.duration ?? 0) + performance.now() - started, calls: (previous?.calls ?? 0) + 1 });
  }
}

/** Wrap selected handlers, including their error responses, without global caches. */
export function withServerTiming<T extends Response>(handler: () => Promise<T>): Promise<T> {
  return requestSpans.run(new Map(), async () => {
    const response = await handler();
    const entries = [...requestSpans.getStore()!.entries()].map(([stage, span]) =>
      `${stage};dur=${span.duration.toFixed(1)};desc="${span.calls} calls"`,
    );
    if (entries.length) response.headers.append("server-timing", entries.join(", "));
    response.headers.set("cache-control", "private, no-store");
    return response;
  });
}

/** Explicitly exclude authenticated Supabase requests from the Next Data Cache. */
export const measuredSupabaseFetch: typeof fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const operation = () => fetch(input, { ...init, cache: "no-store" });
  if (url.pathname.startsWith("/rest/v1/")) return measureServerOperation("db", operation);
  if (url.pathname.startsWith("/auth/v1/")) return measureServerOperation("auth_http", operation);
  if (url.pathname.startsWith("/storage/v1/")) return measureServerOperation("storage", operation);
  return operation();
};
