// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeInnermostPopupMenu } from "./popup-fitter";

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
