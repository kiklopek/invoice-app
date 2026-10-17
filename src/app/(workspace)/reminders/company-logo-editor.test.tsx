// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiFetch: api }));
vi.mock("@/components/company-logo", () => ({ CompanyLogo: ({ src }: { src: string | null }) => React.createElement("span", { "data-logo": src ?? "fallback" }, "Logo") }));
import { CompanyLogoEditor } from "./company-logo-editor";
let root: Root;
let container: HTMLDivElement;
let saved: ReturnType<typeof vi.fn<(src: string | null) => void>>;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.mockReset(); saved = vi.fn();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(src: string | null = null, canEdit = true) {
  await act(async () => root.render(<CompanyLogoEditor src={src} companyName="Firma" canEdit={canEdit} onSaved={saved} />));
}
async function choose(file: File) {
  // jsdom File has no arrayBuffer; browser uploads do.
  Object.defineProperty(file, "slice", { value: () => ({ arrayBuffer: async () => file.type === "image/png" ? new Uint8Array([137,80,78,71,13,10,26,10]).buffer : new Uint8Array([1,2,3]).buffer }) });
  const input = container.querySelector("input")!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
it("uploads a logo as multipart, shows success and publishes the versioned path", async () => {
  vi.useFakeTimers();
  await render(); api.mockResolvedValue({ logo_path: "/logo/company?v=42" });
  await choose(new File(["png"], "firma.png", { type: "image/png" }));
  expect(api).toHaveBeenCalledWith("/api/settings/logo", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
  expect(saved).toHaveBeenCalledWith("/logo/company?v=42");
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Logo je uložené");
  await render("/logo/company?v=42");
  expect(container.querySelector('[data-logo]')?.getAttribute("data-logo")).toBe("/logo/company?v=42");
  expect(container.textContent).not.toContain("Výběrem se logo rovnou uloží");
  expect(container.querySelector('p[role="status"]')).toBeNull();
  await act(async () => vi.advanceTimersByTime(3500));
  expect(container.querySelector('[role="status"]')).toBeNull();
});
it("removes the company logo and publishes the fallback", async () => {
  await render("/logo/company?v=42"); api.mockResolvedValue({ logo_path: null });
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Odebrat logo")!.click());
  expect(api).toHaveBeenCalledWith("/api/settings/logo", { method: "DELETE" });
  expect(saved).toHaveBeenCalledWith(null);
});
it("keeps the existing logo after a rejected upload and allows retry", async () => {
  await render("/logo/company?v=42"); api.mockRejectedValue(new Error("Obrázek je poškozený."));
  await choose(new File(["png"], "firma.png", { type: "image/png" }));
  expect(saved).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Obrázek je poškozený.");
  expect(container.querySelector("button")?.disabled).toBe(false);
});
it("rejects unsupported and oversized files before uploading", async () => {
  await render();
  await choose(new File(["<svg/>"], "firma.svg", { type: "image/svg+xml" }));
  expect(api).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Vyberte obrázek PNG");
  await choose(new File([new Uint8Array(512 * 1024 + 1)], "firma.png", { type: "image/png" }));
  expect(api).not.toHaveBeenCalled();
  expect(container.textContent).toContain("nejvýš 512 kB");
});
it("does not expose editing controls to a non-administrator", async () => {
  await render("/logo/company?v=42", false);
  expect(container.querySelector("input")).toBeNull();
  expect(container.querySelector("button")).toBeNull();
  expect(container.textContent).toContain("administrátor");
});
