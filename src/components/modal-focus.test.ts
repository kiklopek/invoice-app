// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { focusReturnTarget } from "./modal";

afterEach(() => { document.body.innerHTML = ""; });
const visible = (el: Element) => Object.defineProperty(el, "getClientRects", { value: () => [{}] });

describe("focus return after a dialog (WCAG 2.4.3)", () => {
  it("returns to the opener when it is still visible", () => {
    document.body.innerHTML = `<button id="b">Smazat</button>`;
    const b = document.getElementById("b")!; visible(b);
    expect(focusReturnTarget(b)).toBe(b);
  });
  it("returns to the menu's summary when the opener sits in a menu that closed", () => {
    document.body.innerHTML = `<details><summary id="s">⋯</summary><div data-popup><button id="b">Smazat</button></div></details>`;
    visible(document.getElementById("s")!);
    expect(focusReturnTarget(document.getElementById("b"))?.id).toBe("s");
  });
  it("gives up when the opener left the page", () => {
    const b = document.createElement("button");
    expect(focusReturnTarget(b)).toBeNull();
    expect(focusReturnTarget(null)).toBeNull();
  });
});
