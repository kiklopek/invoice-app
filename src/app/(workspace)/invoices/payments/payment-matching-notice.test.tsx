// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MatchingNotice } from "./payment-matching-notice";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("hides the notice after five seconds without removing continuation actions", async () => {
  await act(async () => root.render(<><MatchingNotice message="Hotovo" className="success" /><button>Další výpis</button></>));
  await act(async () => vi.advanceTimersByTime(4999));
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Hotovo");
  await act(async () => vi.advanceTimersByTime(1));
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector("button")?.textContent).toBe("Další výpis");
});

it("gives each new message its own five seconds and ignores unrelated rerenders", async () => {
  const render = (message: string) => act(async () => root.render(<MatchingNotice message={message} className="success" />));
  await render("První");
  await act(async () => vi.advanceTimersByTime(4000));
  await render("Druhá");
  await act(async () => vi.advanceTimersByTime(4000));
  await render("Druhá");
  expect(host.textContent).toBe("Druhá");
  await act(async () => vi.advanceTimersByTime(1000));
  expect(host.textContent).toBe("");
});
