// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { RouterCacheInvalidator } from "./router-cache-invalidator";

describe("RouterCacheInvalidator", () => {
  let host: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof window.fetch;

  beforeEach(async () => {
    vi.useFakeTimers();
    refresh.mockReset();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    originalFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    window.fetch = originalFetch;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<RouterCacheInvalidator />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("po uložení zahodí zapamatované stránky, jednou i za několik změn", async () => {
    await window.fetch("/api/invoices/1", { method: "PATCH" });
    await window.fetch("/api/payments", { method: "DELETE" });
    vi.advanceTimersByTime(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(originalFetch).toHaveBeenCalledTimes(2);
  });

  it("čtení stránku neobnovuje", async () => {
    await window.fetch("/api/dashboard");
    vi.advanceTimersByTime(200);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("po odpojení vrátí původní fetch", async () => {
    await act(async () => root.unmount());
    expect(window.fetch).toBe(originalFetch);
    root = createRoot(host);
  });
});
