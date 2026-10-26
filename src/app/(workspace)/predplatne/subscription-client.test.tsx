// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { BillingResponse } from "@/lib/subscription-view";
const mocks = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("@/lib/confirm-action", () => ({ confirmAction: mocks.confirm }));
vi.mock("@/components/layout/app-shell", () => ({ AppFrame: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
import { SubscriptionClient } from "./subscription-client";
let host: HTMLDivElement, root: Root, billing: BillingResponse;
let fetcher: ReturnType<typeof vi.fn>;
const buttons = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.textContent === text);
async function click(text: string) { const button = buttons(text)[0]; expect(button).toBeDefined(); await act(async () => button.click()); }
async function render() { await act(async () => root.render(<SubscriptionClient/>)); }
const mutations = () => fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.confirm.mockReset().mockResolvedValue(true);
  billing = { subscription: { status: "active", state: "active", plan: "profi", period: "monthly", current_period_end: "2026-11-23T00:00:00Z", has_card: true, managed_by_stripe: true, billing_exempt: false }, can_manage: true, available: true, vat_payer: false, details: { pricing: { amount: 139000, nextAmount: 99000, currency: "czk", interval: "month", nextAt: "2026-11-23" }, card: { brand: "visa", last4: "1111", expMonth: 12, expYear: 2028, expired: false }, paymentType: "card", history: [], error: false }, usage: { month: "2026-10-01T00:00:00Z", metrics: [{ key: "invoices", label: "Faktury", used: 24, limit: 500, period: "month" }, { key: "customers", label: "Zákazníci", used: 18, limit: null, period: "total" }] } };
  fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const action = init?.body ? JSON.parse(String(init.body)).action : null;
    return { ok: true, json: async () => !init?.method ? billing : action === "preview" ? { kind: "downgrade", dueNowHalere: 0, nextChargeHalere: 79000, effectiveAt: "2026-11-23", prorationDate: 1791000000 } : action === "preview_end_trial" ? { dueNowHalere: 99000, currency: "czk" } : { status: "changed" } };
  });
  vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); window.history.replaceState(null, "", "/"); vi.unstubAllGlobals(); });
it("shows real subscription pricing and a card, with configured plans and no invented unlimited progress", async () => {
  await render(); expect(host.textContent).toContain("990"); expect(host.textContent).toContain("1111");
  expect(host.querySelectorAll("progress")).toHaveLength(1);
  expect(host.querySelector('progress')?.getAttribute("max")).toBe("500");
  expect(host.textContent).toContain("Profi"); expect(host.textContent).toContain("Business"); expect(host.textContent).not.toContain("Enterprise");
});
it("only previews annual catalog prices without a billing mutation", async () => {
  await render(); await act(async () => host.querySelector<HTMLButtonElement>('[aria-pressed="false"]')!.click());
  expect(host.textContent).toContain("Roční platba"); expect(mutations()).toHaveLength(0);
});
it("retries a failed initial load", async () => {
  fetcher.mockResolvedValueOnce({ ok: false }); await render(); expect(host.textContent).toContain("Nepodařilo se načíst");
  await click("Zkusit znovu"); expect(host.textContent).toContain("Aktuální plán");
});
it("cancels at period end only after confirmation", async () => {
  await render(); mocks.confirm.mockResolvedValueOnce(false); await click("Zrušit předplatné"); expect(mutations()).toHaveLength(0);
  await click("Zrušit předplatné"); expect(JSON.parse(mutations()[0][1].body)).toMatchObject({ action: "cancel", confirm: true });
  expect(mocks.confirm.mock.calls[0][0].description).toContain("23. 11. 2026");
});
it("uses a trusted preview before ending the trial", async () => {
  billing.subscription.state = "trial"; billing.subscription.status = "trialing"; billing.subscription.trial_ends_at = "2026-11-02";
  await render(); await click("Začít platit hned");
  expect(JSON.parse(mutations()[0][1].body).action).toBe("preview_end_trial");
  expect(mocks.confirm.mock.calls[0][0].title).toContain("990");
  expect(JSON.parse(mutations()[1][1].body)).toMatchObject({ action: "end_trial", confirm: true });
});
it("prevents duplicate preview requests on rapid clicks", async () => {
  await render(); const button = buttons("Zvolit plán")[0];
  await act(async () => { button.click(); button.click(); });
  expect(mutations().filter(([, init]) => JSON.parse(init.body).action === "preview")).toHaveLength(1);
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
});
it("allows read-only tariff access without billing management", async () => {
  billing.can_manage = false; billing.details = null; await render();
  expect(buttons("Změnit plán")[0].disabled).toBe(true);
  expect(host.textContent).toContain("Předplatné spravuje administrátor");
  expect(host.textContent).not.toContain("1111"); expect(mutations()).toHaveLength(0);
});
it("preserves permanent access without offering a paid plan", async () => {
  billing.subscription.billing_exempt = true; billing.subscription.has_card = false; await render();
  expect(host.textContent).toContain("Trvalý přístup"); expect(host.textContent).not.toContain("Dostupné plány"); expect(mutations()).toHaveLength(0);
});
it("renders payment failure with one actionable alert", async () => {
  billing.subscription.state = "past_due"; await render();
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(buttons("Opravit platební údaje")).toHaveLength(1);
  expect(buttons("Zvolit plán").every(button => button.disabled)).toBe(true);
});
it("does not create another subscription when the existing one is paused", async () => {
  billing.subscription.status = "paused"; billing.subscription.state = "expired"; await render();
  expect(buttons("Zvolit plán").every(button => button.disabled)).toBe(true);
  expect(buttons("Vyřešit předplatné ve Stripe")).toHaveLength(1);
  expect(mutations()).toHaveLength(0);
});
it("does not claim that a pending setup session has completed", async () => {
  window.history.replaceState(null, "", "/predplatne?platba=hotovo&session=cs_fixture");
  const original = fetcher.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  fetcher.mockImplementation((url: string, init?: RequestInit) => url === "/api/billing/activate" ? Promise.resolve({ ok: true, json: async () => ({ status: "pending" }) }) : original(url, init));
  await render(); expect(host.textContent).toContain("ještě nepotvrdila dokončení"); expect(host.textContent).not.toContain("Karta je uložená.");
});
