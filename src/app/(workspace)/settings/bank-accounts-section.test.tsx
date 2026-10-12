// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchAccounts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiFetch: fetchAccounts }));
import { BankAccountsSection } from "./bank-accounts-section";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchAccounts.mockReset().mockResolvedValue({ accounts: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("server-hydrated bank accounts", () => {
  it("does not authenticate or fetch again when the server provided an empty list", async () => {
    await act(async () => root.render(<BankAccountsSection canEdit initialAccounts={[]} onMessage={() => {}} />));
    expect(fetchAccounts).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Zatím nemáte žádné další účty.");
  });

  it("reflects a refreshed server list without an API waterfall", async () => {
    await act(async () => root.render(<BankAccountsSection canEdit={false} initialAccounts={[]} onMessage={() => {}} />));
    await act(async () => root.render(<BankAccountsSection canEdit={false} initialAccounts={[{ id: "fixture", account: "fixture-account", currency: "EUR", label: null }]} onMessage={() => {}} />));
    expect(fetchAccounts).not.toHaveBeenCalled();
    expect(container.textContent).toContain("fixture-account");
    expect(container.querySelector("form")).toBeNull();
  });
});
