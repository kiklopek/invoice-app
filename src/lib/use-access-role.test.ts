import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const profile = { role: "admin", name: "Test", email: "test@example.com", companyName: "Firma" };

describe("navigation profile requests", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shares concurrent requests and reuses the result across page transitions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(profile)));
    vi.stubGlobal("fetch", fetchMock);
    const { loadProfile } = await import("./use-access-role");
    const first = loadProfile();
    const second = loadProfile();
    expect(first).toBe(second);
    expect(await first).toEqual(profile);
    expect(await loadProfile()).toEqual(profile);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes permissions after the short cache lifetime", async () => {
    const updated = { ...profile, role: "viewer" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(profile)))
      .mockResolvedValueOnce(new Response(JSON.stringify(updated)));
    vi.stubGlobal("fetch", fetchMock);
    const { loadProfile } = await import("./use-access-role");
    await loadProfile();
    vi.advanceTimersByTime(30_001);
    expect(await loadProfile()).toEqual(updated);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache denied access or failed requests", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 403 }))
      .mockRejectedValueOnce(new TypeError("Offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify(profile)));
    vi.stubGlobal("fetch", fetchMock);
    const { loadProfile } = await import("./use-access-role");
    expect(await loadProfile()).toBeNull();
    expect(await loadProfile()).toBeNull();
    expect(await loadProfile()).toEqual(profile);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
