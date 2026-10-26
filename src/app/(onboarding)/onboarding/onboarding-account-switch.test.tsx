// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingAccountSwitch } from "./onboarding-account-switch";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@/lib/sign-out", () => ({ signOutCurrentSession: signOut }));
let root: Root, container: HTMLDivElement;
let navigate: ReturnType<typeof vi.fn<(path: string) => void>>;
let stop: ReturnType<typeof vi.fn<() => void>>, resume: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigate = vi.fn(); stop = vi.fn(); resume = vi.fn();
  const browserWindow = Object.create(window);
  Object.defineProperty(browserWindow, "location", { value: { replace: navigate } });
  vi.stubGlobal("window", browserWindow);
  signOut.mockReset(); signOut.mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(<OnboardingAccountSwitch onBeforeSignOut={stop} onSignOutFailed={resume} />));
}
describe("leaving onboarding for another account", () => {
  it("logs out before replacing the page with the login, without a returnTo loop", async () => {
    let finish!: () => void;
    signOut.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await render();
    await act(async () => container.querySelector("button")!.click());
    expect(stop).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(container.querySelector("button")!.disabled).toBe(true);
    await act(async () => finish());
    expect(navigate).toHaveBeenCalledWith("/login");
    expect(resume).not.toHaveBeenCalled();
  });
  it("stays on the draft and allows retry if logout fails", async () => {
    signOut.mockRejectedValueOnce(new Error("offline"));
    await render();
    await act(async () => container.querySelector("button")!.click());
    expect(navigate).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("Odhlášení se nepodařilo");
    expect(container.querySelector("button")!.disabled).toBe(false);
    await act(async () => container.querySelector("button")!.click());
    expect(navigate).toHaveBeenCalledWith("/login");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("starts only one logout for repeated clicks", async () => {
    signOut.mockImplementation(() => new Promise(() => {}));
    await render();
    await act(async () => {
      container.querySelector("button")!.click();
      container.querySelector("button")!.click();
    });
    expect(signOut).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });
});
