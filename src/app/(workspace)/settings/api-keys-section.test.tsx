// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { request, confirm } = vi.hoisted(() => ({ request: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiFetch: request }));
vi.mock("@/lib/confirm-action", () => ({ confirmAction: confirm }));
import { ApiKeysSection } from "./api-keys-section";

const item = {
  id: "api-key-1", name: "E-shop", key_prefix: "abcdefgh", scopes: ["invoices:read", "invoices:write"],
  created_at: "2026-11-14T10:00:00Z", last_used_at: null, expires_at: null, revoked_at: null,
};
let root: Root;
let container: HTMLDivElement;
const click = async (name: string) => {
  const button = Array.from(container.querySelectorAll("button")).find((el) => el.textContent === name);
  expect(button, name).toBeDefined();
  await act(async () => button!.click());
};
const input = async (selector: string, value: string) => {
  const element = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset().mockResolvedValue({ keys: [item] });
  confirm.mockReset().mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("API keys settings", () => {
  it("does not expose or request key metadata for non-admin users", async () => {
    await act(async () => root.render(<ApiKeysSection canEdit={false} />));
    expect(request).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("shows metadata without an existing secret and requires confirmation before revoking", async () => {
    await act(async () => root.render(<ApiKeysSection canEdit />));
    expect(container.textContent).toContain("E-shop");
    expect(container.textContent).toContain("abcdefgh");
    expect(container.textContent).toContain("Zatím nepoužitý");
    confirm.mockResolvedValueOnce(false);
    await click("Zrušit klíč");
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValueOnce({ revoked: true });
    await click("Zrušit klíč");
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("E-shop") }));
    expect(request).toHaveBeenLastCalledWith("/api/settings/api-keys", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ id: item.id }) }));
    expect(container.textContent).toContain("Zrušený");
    expect(Array.from(container.querySelectorAll("button")).some((el) => el.textContent === "Zrušit klíč")).toBe(false);
  });

  it("creates only selected permissions and removes the one-time secret when dismissed", async () => {
    await act(async () => root.render(<ApiKeysSection canEdit />));
    await input('[name="api-key-name"]', "Účetní systém");
    const sending = container.querySelector<HTMLInputElement>('input[value="invoices:send"]')!;
    await act(async () => sending.click());
    const secret = "spl_once-only-secret";
    request.mockResolvedValueOnce({ key: secret, api_key: { ...item, id: "new", name: "Účetní systém" } });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const body = JSON.parse(request.mock.calls[1][1].body);
    expect(body).toEqual({ name: "Účetní systém", scopes: ["invoices:read", "invoices:write", "invoices:send"], expires_at: null });
    expect(container.querySelector<HTMLInputElement>('[aria-label="Nový API klíč"]')?.value).toBe(secret);
    expect(container.textContent).toContain("Klíč se už znovu nezobrazí");
    await click("Klíč mám uložený");
    expect(container.querySelector('[aria-label="Nový API klíč"]')).toBeNull();
    expect(container.innerHTML).not.toContain(secret);
  });

  it("keeps loading errors visible and offers a retry", async () => {
    request.mockRejectedValueOnce(new Error("Klíče se nepodařilo načíst."));
    await act(async () => root.render(<ApiKeysSection canEdit />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Klíče se nepodařilo načíst.");
    await click("Načíst znovu");
    expect(container.textContent).toContain("E-shop");
  });
});
