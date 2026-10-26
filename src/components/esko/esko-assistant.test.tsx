// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EskoAssistant } from "./esko-assistant";
import { EskoAssistantProvider, EskoNavigationButton, useEskoAssistant } from "./esko-context";
import { ESKO_MINIMIZED_KEY } from "@/lib/esko-visibility";
const { swr } = vi.hoisted(() => ({ swr: vi.fn(() => ({})) }));
vi.mock("swr", () => ({ default: swr }));
vi.mock("@/lib/use-access-role", () => ({ useAccessProfile: () => ({ role: "admin" }) }));
vi.mock("next/image", () => ({ default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement("img", props) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
function Navigation() {
  const { openAssistant } = useEskoAssistant();
  return <EskoNavigationButton onClick={e => openAssistant(e.currentTarget)} />;
}
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  swr.mockClear();
  HTMLElement.prototype.scrollTo = vi.fn();
  window.sessionStorage.clear();
  HTMLDialogElement.prototype.show = function () { this.setAttribute("open", ""); };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<EskoAssistantProvider><Navigation /><EskoAssistant /></EskoAssistantProvider>)); }
async function open() { await act(async () => container.querySelector<HTMLButtonElement>("button")!.click()); }
async function close() { await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Zavřít chat Esko"]')!.click()); }
describe("Esko in navigation", () => {
  it("ignores the old minimized preference, keeps navigation available and loads only on open", async () => {
    window.sessionStorage.setItem(ESKO_MINIMIZED_KEY, "1");
    await render();
    expect(container.textContent).toContain("Esko");
    expect(container.querySelector('[data-esko-launcher]')).toBeNull();
    expect(swr).toHaveBeenLastCalledWith(null);
    await open();
    expect(document.querySelector("dialog[open]")).not.toBeNull();
    expect(swr).toHaveBeenLastCalledWith("/api/dashboard");
  });
  it("closes and restores focus to its navigation trigger", async () => {
    await render(); const trigger = container.querySelector("button");
    await open(); await close();
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(swr).toHaveBeenLastCalledWith(null);
  });
  it("dismisses the modeless chat with Escape even after a disabled send button loses focus", async () => {
    await render(); await open();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("button"));
  });
  it("retains a draft while the dialog is closed", async () => {
    await render(); await open();
    await act(async () => {
      const input = document.querySelector("input")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"Rozepsaná otázka");
      input.dispatchEvent(new Event("input",{bubbles:true}));
    });
    await close(); await open();
    expect(document.querySelector("input")!.value).toBe("Rozepsaná otázka");
  });
  it("retains conversation history across closes", async () => {
    await render(); await open();
    await act(async () => {
      const input = document.querySelector("input")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"pomoc");
      input.dispatchEvent(new Event("input",{bubbles:true}));
    });
    await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
    await close(); await open();
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toContain("pomoc");
  });
});
