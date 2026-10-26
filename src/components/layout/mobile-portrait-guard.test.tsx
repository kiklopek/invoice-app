// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobilePortraitGuard, phoneNeedsPortrait } from "./mobile-portrait-guard";

let host: HTMLDivElement, root: Root;
let orientation: EventTarget & { type: string; lock: ReturnType<typeof vi.fn>; unlock: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { maxTouchPoints: 1 });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  orientation = Object.assign(new EventTarget(), {
    type: "portrait-primary",
    lock: vi.fn().mockRejectedValue(new Error("Not supported")),
    unlock: vi.fn(),
  });
  vi.stubGlobal("screen", { width: 390, height: 844, orientation });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mobile portrait mode", () => {
  it("only blocks a phone's physical landscape orientation", () => {
    expect(phoneNeedsPortrait()).toBe(false);
    orientation.type = "landscape-primary";
    expect(phoneNeedsPortrait()).toBe(true);
    vi.stubGlobal("navigator", { maxTouchPoints: 0 });
    expect(phoneNeedsPortrait()).toBe(false);
  });

  it("leaves tablets and desktop screens available in landscape", () => {
    orientation.type = "landscape-primary";
    vi.stubGlobal("screen", { width: 1024, height: 768, orientation });
    expect(phoneNeedsPortrait()).toBe(false);
  });

  it("does not mistake the on-screen keyboard for rotating the phone", () => {
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 240);
    expect(phoneNeedsPortrait()).toBe(false);
  });

  it("preserves input and focus when rotating back to portrait", async () => {
    await act(async () => root.render(<><input aria-label="Rozepsaný údaj" defaultValue="Neuložené údaje"/><MobilePortraitGuard/></>));
    const input = host.querySelector("input")!;
    input.focus();
    await act(async () => {
      orientation.type = "landscape-primary";
      orientation.dispatchEvent(new Event("change"));
    });
    const dialog = host.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    await act(async () => {
      orientation.type = "portrait-primary";
      orientation.dispatchEvent(new Event("change"));
    });
    expect(host.querySelector("dialog")).toBeNull();
    expect(input.value).toBe("Neuložené údaje");
    expect(document.activeElement).toBe(input);
  });

  it("uses native locking when available and releases an acquired lock on unmount", async () => {
    orientation.lock.mockResolvedValue(undefined);
    await act(async () => root.render(<MobilePortraitGuard/>));
    expect(orientation.lock).toHaveBeenCalledWith("portrait");
    await act(async () => root.render(null));
    expect(orientation.unlock).toHaveBeenCalledOnce();
  });

  it("keeps the portrait notice when native locking is rejected", async () => {
    orientation.type = "landscape-primary";
    await act(async () => root.render(<MobilePortraitGuard/>));
    expect(host.querySelector("dialog")?.textContent).toContain("Otočte telefon na výšku");
    expect(orientation.unlock).not.toHaveBeenCalled();
  });
});
