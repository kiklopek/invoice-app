// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hook chrání rozepsanou fakturu před odchodem ze stránky. Neměl test,
// přestože jeho selhání znamená buď ztracenou práci (neptá se), nebo
// nepoužitelnou aplikaci (ptá se na všechno včetně odkazů mimo web).
//
// Testuje se chování posluchače, ne React: hook se nasadí ručně, protože
// projekt nemá knihovnu na renderování komponent a kvůli jednomu souboru
// ji zavádět nebudu.

const pushed: string[] = [];
let confirmResult = true;
const confirmCalls: Array<{ title: string }> = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => pushed.push(url) }),
}));

vi.mock("@/lib/confirm-action", () => ({
  confirmAction: async (options: { title: string }) => {
    confirmCalls.push(options);
    return confirmResult;
  },
}));

// Minimální náhrada Reactu: spustí efekt a vrátí jeho úklid.
const effects: Array<() => void> = [];
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: (fn: () => void | (() => void)) => {
      const cleanup = fn();
      if (typeof cleanup === "function") effects.push(cleanup);
    },
  };
});

const { useUnsavedChanges } = await import("./use-unsaved-changes");

function link(href: string, attributes: Record<string, string> = {}) {
  const anchor = document.createElement("a");
  anchor.href = href;
  for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value);
  document.body.append(anchor);
  return anchor;
}

const clickWith = (anchor: HTMLAnchorElement, init: MouseEventInit = {}) => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  anchor.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  pushed.length = 0;
  confirmCalls.length = 0;
  effects.length = 0;
  confirmResult = true;
  document.body.innerHTML = "";
});

afterEach(() => {
  for (const cleanup of effects) cleanup();
});

describe("useUnsavedChanges", () => {
  it("asks before leaving when there are unsaved changes", async () => {
    useUnsavedChanges(true);
    const event = clickWith(link("/invoices"));
    expect(event.defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(confirmCalls[0].title).toContain("Opustit stránku");
  });

  it("navigates only after the user agrees", async () => {
    useUnsavedChanges(true);
    clickWith(link("/invoices?q=a"));
    await Promise.resolve();
    await Promise.resolve();
    expect(pushed).toEqual(["/invoices?q=a"]);
  });

  it("stays on the page when the user refuses", async () => {
    confirmResult = false;
    useUnsavedChanges(true);
    clickWith(link("/invoices"));
    await Promise.resolve();
    await Promise.resolve();
    expect(pushed).toEqual([]);
  });

  it("does nothing at all when there is nothing to lose", () => {
    // Ptát se na odchod z uložené stránky je jen otravné.
    useUnsavedChanges(false);
    const event = clickWith(link("/invoices"));
    expect(event.defaultPrevented).toBe(false);
    expect(confirmCalls).toEqual([]);
  });

  it("lets modifier clicks through, because they open a new tab", () => {
    // Ctrl/Cmd+klik stránku neopouští, takže není co ztratit.
    useUnsavedChanges(true);
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
      expect(clickWith(link("/invoices"), modifier).defaultPrevented, JSON.stringify(modifier)).toBe(false);
    }
    expect(confirmCalls).toEqual([]);
  });

  it("ignores a middle or right click", () => {
    useUnsavedChanges(true);
    expect(clickWith(link("/invoices"), { button: 1 }).defaultPrevented).toBe(false);
  });

  it("ignores links that leave the application", () => {
    useUnsavedChanges(true);
    expect(clickWith(link("https://example.com/x")).defaultPrevented).toBe(false);
    expect(clickWith(link("/invoices", { target: "_blank" })).defaultPrevented).toBe(false);
    expect(confirmCalls).toEqual([]);
  });

  it("ignores a link to the page the user is already on", () => {
    useUnsavedChanges(true);
    const anchor = link(window.location.href);
    expect(clickWith(anchor).defaultPrevented).toBe(false);
  });

  it("never opens two dialogs at once", async () => {
    // Dvojklik na odkaz by jinak naskládal dialogy na sebe.
    useUnsavedChanges(true);
    const anchor = link("/invoices");
    clickWith(anchor);
    clickWith(anchor);
    await Promise.resolve();
    expect(confirmCalls).toHaveLength(1);
  });

  it("runs the discard callback before navigating away", async () => {
    const order: string[] = [];
    useUnsavedChanges(true, () => order.push("discard"));
    clickWith(link("/invoices"));
    await Promise.resolve();
    await Promise.resolve();
    order.push("navigate");
    expect(order).toEqual(["discard", "navigate"]);
  });

  it("stops listening once the changes are saved", () => {
    useUnsavedChanges(true);
    for (const cleanup of effects) cleanup();
    effects.length = 0;
    expect(clickWith(link("/invoices")).defaultPrevented).toBe(false);
  });
});
