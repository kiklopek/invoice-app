// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeInnermostPopupMenu, closeOtherPopupMenus, closePopupMenusOutside, PopupFitter } from "./popup-fitter";

afterEach(() => { document.body.innerHTML = ""; });

describe("Escape on popup menus (WCAG 2.1.1, handoff I-R05)", () => {
  it("closes the open menu and returns focus to its summary", () => {
    document.body.innerHTML = `<details open id="m"><summary>⋯</summary><div data-popup><a href="#">Archiv</a></div></details>`;
    (document.querySelector("a") as HTMLElement).focus();
    expect(closeInnermostPopupMenu(document)).toBe(true);
    expect((document.getElementById("m") as HTMLDetailsElement).open).toBe(false);
    expect(document.activeElement?.tagName).toBe("SUMMARY");
  });
  it("closes only the innermost of nested menus", () => {
    document.body.innerHTML = `<details open id="outer"><summary>a</summary><div data-popup>
      <details open id="inner"><summary>b</summary><div data-popup><button>x</button></div></details></div></details>`;
    (document.querySelector("button") as HTMLElement).focus();
    closeInnermostPopupMenu(document);
    expect((document.getElementById("inner") as HTMLDetailsElement).open).toBe(false);
    expect((document.getElementById("outer") as HTMLDetailsElement).open).toBe(true);
  });
  it("leaves accordions and anything under an open modal dialog alone", () => {
    document.body.innerHTML = `<details open id="acc"><summary>Historie</summary><div>obsah</div></details>
      <details open id="m"><summary>⋯</summary><div data-popup>menu</div></details>
      <dialog id="d"><button>OK</button></dialog>`;
    const dialog = document.getElementById("d") as HTMLDialogElement;
    dialog.setAttribute("open", "");
    dialog.setAttribute("aria-modal", "true");
    expect(closeInnermostPopupMenu(document)).toBe(false);
    expect((document.getElementById("m") as HTMLDetailsElement).open).toBe(true);
    dialog.removeAttribute("open");
    expect(closeInnermostPopupMenu(document)).toBe(true);
    expect((document.getElementById("acc") as HTMLDetailsElement).open).toBe(true);
  });
});

const menu = (id: string) => document.getElementById(id) as HTMLDetailsElement;

describe("light dismiss of popup menus", () => {
  it("closes open menus when the user presses anywhere outside them", () => {
    document.body.innerHTML = `<details open id="a"><summary>⋯</summary><div data-popup><button id="inside">Archiv</button></div></details>
      <details open id="acc"><summary>Historie</summary><div>obsah</div></details><main id="page">stránka</main>`;
    closePopupMenusOutside(document, document.getElementById("inside"));
    expect(menu("a").open).toBe(true);
    closePopupMenusOutside(document, document.getElementById("page"));
    expect(menu("a").open).toBe(false);
    // Accordions are not menus and stay open.
    expect(menu("acc").open).toBe(true);
  });

  it("keeps a parent menu open while its nested menu is used", () => {
    document.body.innerHTML = `<details open id="outer"><summary>a</summary><div data-popup>
      <details open id="inner"><summary>b</summary><div data-popup><button id="x">x</button></div></details></div></details>`;
    closePopupMenusOutside(document, document.getElementById("x"));
    expect(menu("outer").open).toBe(true);
    expect(menu("inner").open).toBe(true);
  });

  it("does not close menus behind an open modal dialog when the dialog is clicked", () => {
    document.body.innerHTML = `<details open id="a"><summary>⋯</summary><div data-popup>menu</div></details>
      <dialog id="d" open aria-modal="true"><button id="ok">OK</button></dialog>`;
    closePopupMenusOutside(document, document.getElementById("ok"));
    expect(menu("a").open).toBe(true);
  });

  it("opening one menu closes the others but not its own ancestors", () => {
    document.body.innerHTML = `<details open id="a"><summary>a</summary><div data-popup>A</div></details>
      <details open id="outer"><summary>o</summary><div data-popup>
        <details open id="inner"><summary>i</summary><div data-popup>I</div></details></div></details>
      <details open id="acc"><summary>Historie</summary><div>obsah</div></details>`;
    closeOtherPopupMenus(document, menu("inner"));
    expect(menu("a").open).toBe(false);
    expect(menu("outer").open).toBe(true);
    expect(menu("inner").open).toBe(true);
    expect(menu("acc").open).toBe(true);
  });

  it("is wired into the app-wide PopupFitter", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    document.body.innerHTML = `<details id="a"><summary id="sa">a</summary><div data-popup>A</div></details>
      <details id="b"><summary id="sb">b</summary><div data-popup>B</div></details><main id="page">stránka</main><div id="root"></div>`;
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<PopupFitter />));
    menu("a").open = true;
    await act(async () => { menu("a").dispatchEvent(new Event("toggle")); });
    menu("b").open = true;
    await act(async () => { menu("b").dispatchEvent(new Event("toggle")); });
    expect(menu("a").open).toBe(false);
    expect(menu("b").open).toBe(true);
    await act(async () => { document.getElementById("page")!.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(menu("b").open).toBe(false);
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });
});
