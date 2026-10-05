// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignableBankPayment } from "@/lib/assignable-bank-payment";
import { OptionalPaymentAssignment } from "./optional-payment-assignment";

const mocks = vi.hoisted(() => ({ useSWR: vi.fn() }));
vi.mock("swr", () => ({ default: mocks.useSWR }));
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const payment = (id: string, recommended: boolean, unavailable_reason: string | null = null): AssignableBankPayment => ({
  id, recommended, unavailable_reason, amount: recommended ? 1000 : 400, currency: "CZK",
  booked_on: "2026-10-05", variable_symbol: "123", counterparty_name: "Plátce", match_status: "unmatched",
});
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  mocks.useSWR.mockReturnValue({ data: { payments: [payment("other", false), payment("recommended", true), payment("incompatible", false, "Jiná měna než na faktuře")], remaining_amount: 1000 } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(selectedPaymentId = "") {
  const onSelectPayment = vi.fn();
  const onConfirmWithoutPayment = vi.fn();
  act(() => root.render(createElement(OptionalPaymentAssignment, {
    invoiceId: "invoice", enabled: true, selectedPaymentId, confirmWithoutPayment: false,
    onSelectPayment, onConfirmWithoutPayment,
  })));
  return { onSelectPayment, onConfirmWithoutPayment };
}

describe("výběr nepřiřazené bankovní platby", () => {
  it("zobrazuje doporučené nahoře a ostatní bez duplicit pod nimi", () => {
    render();
    expect([...container.querySelectorAll("optgroup")].map(group => group.label)).toEqual(["Doporučené platby", "Ostatní nepřiřazené platby"]);
    expect([...container.querySelectorAll("option")].map(option => option.value)).toEqual(["", "recommended", "other", "incompatible"]);
    expect(container.querySelector<HTMLOptionElement>('option[value="incompatible"]')?.disabled).toBe(true);
    expect(container.querySelector('option[value="incompatible"]')?.textContent).toContain("Jiná měna než na faktuře");
  });

  it("nabídne ostatní i bez doporučených a dovolí vybrat částečnou platbu", () => {
    mocks.useSWR.mockReturnValue({ data: { payments: [payment("other", false)], remaining_amount: 1000 } });
    const callbacks = render();
    expect(container.querySelector("optgroup")?.label).toBe("Ostatní nepřiřazené platby");
    const select = container.querySelector("select")!;
    act(() => {
      select.value = "other";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(callbacks.onSelectPayment).toHaveBeenCalledWith("other");
    expect(callbacks.onConfirmWithoutPayment).toHaveBeenCalledWith(false);
    render("other");
    expect(container.textContent).toContain("Platba pokryje část úhrady. Zbývá doplatit 600,00");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("rozlišuje prázdný seznam od absence přesné shody", () => {
    mocks.useSWR.mockReturnValue({ data: { payments: [], remaining_amount: 1000 } });
    render();
    expect(container.querySelector("option")?.textContent).toBe("Žádná nepřiřazená platba");
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
  });
});
