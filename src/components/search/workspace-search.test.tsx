// @vitest-environment jsdom
import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiFetch: mocks.fetch }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
import { WorkspaceSearch } from "./workspace-search";
const results = [
  {
    id: "invoice",
    type: "invoice",
    title: "Faktura 2600220",
    subtitle: "ACME · 125 000 Kč",
    href: "/invoices/invoice",
  },
  {
    id: "customer",
    type: "customer",
    title: "ACME",
    subtitle: "IČO 12345678",
    href: "/customers?highlight=customer",
  },
  {
    id: "payment",
    type: "payment",
    title: "Platba ACME",
    subtitle: "19. 10. 2026 · 125 000 Kč",
    href: "/invoices/payments/archive?highlight=payment#payment-payment",
  },
];
let root: Root, container: HTMLDivElement;
function Harness() {
  return <WorkspaceSearch inputRef={useRef<HTMLInputElement>(null)} />;
}
beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.fetch.mockReset();
  mocks.push.mockReset();
  mocks.fetch.mockResolvedValue({ results, unavailable: [] });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
});
const input = () => container.querySelector<HTMLInputElement>("input")!;
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}
async function type(value: string, wait = true) {
  await act(async () => {
    input().focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (wait) await settle();
}
async function key(value: string) {
  await act(async () => {
    input().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
describe("workspace search dropdown", () => {
  it("opens and fetches possible results from the first typed character", async () => {
    expect(container.querySelector("kbd")).not.toBeNull();
    await type("a", false);
    expect(container.querySelector("kbd")).toBeNull();
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(mocks.fetch.mock.calls[0][0]).toBe("/api/search?q=a");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(3);
    await type("", false);
    expect(container.querySelector("kbd")).not.toBeNull();
  });
  it("searches immediately on each change and shows distinct invoice, client and payment destinations", async () => {
    await type("ac", false);
    await type("acm", false);
    await type("acme", false);
    await settle();
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.fetch.mock.calls.at(-1)![0]).toBe("/api/search?q=acme");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(3);
    for (const result of results)
      expect(
        container
          .querySelector(`a[data-search-type="${result.type}"]`)!
          .getAttribute("href"),
      ).toBe(result.href);
  });
  it("selects a result with arrows and Enter and dismisses with Escape", async () => {
    await type("acme");
    await key("ArrowDown");
    await key("ArrowDown");
    const selected = container.querySelector('[aria-selected="true"]')!;
    expect(selected.textContent).toContain("IČO 12345678");
    expect(input().getAttribute("aria-activedescendant")).toBe(selected.id);
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(mocks.push).toHaveBeenCalledWith("/customers?highlight=customer");
    await type("acme");
    await key("Escape");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(input());
  });
  it("cancels superseded requests and never renders late results from another query", async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.fetch.mockImplementation((url: string) =>
      url.includes("old")
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve({ results, unavailable: [] }),
    );
    await type("old");
    const signal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
    await type("acme");
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolveOld({
        results: [{ ...results[0], title: "OLD RESULT" }],
        unavailable: [],
      });
    });
    expect(container.textContent).toContain("Faktura 2600220");
    expect(container.textContent).not.toContain("OLD RESULT");
  });
  it("distinguishes no matches from failures and supports retry", async () => {
    mocks.fetch.mockRejectedValue(new Error("Vyhledávání je nedostupné"));
    await type("acme");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "nedostupné",
    );
    expect(container.textContent).not.toContain("nic nenašli");
    mocks.fetch.mockResolvedValue({ results: [], unavailable: [] });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[role="alert"] button')!
        .click();
    });
    await settle();
    expect(container.textContent).toContain("nic nenašli");
  });
  it("keeps partial results and names the unavailable category", async () => {
    mocks.fetch.mockResolvedValue({
      results: results.slice(0, 2),
      unavailable: ["payment"],
    });
    await type("acme");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(container.textContent).toContain(
      "Platba: výsledky se nepodařilo načíst",
    );
  });
  it("closes on outside interaction and preserves exact-amount navigation", async () => {
    await type("125 000,50 Kč");
    expect(
      container.querySelector(
        'a[href="/invoices?amount_min=125000.5&amount_max=125000.5&currency=CZK"]',
      ),
    ).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
});
