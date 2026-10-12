import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadProfile, resetAccessProfileCache } from "./use-access-role";

const first = { role: "admin", name: "Fixture A", email: "a@example.invalid", companyName: "Fixture A" };
const second = { role: "viewer", name: "Fixture B", email: "b@example.invalid", companyName: "Fixture B" };
beforeEach(() => resetAccessProfileCache());
afterEach(() => { resetAccessProfileCache(); vi.unstubAllGlobals(); });

describe("access profile cache", () => {
  it("deduplicates in-flight reads for the current identity", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(first));
    vi.stubGlobal("fetch", fetch);
    const [a, b] = await Promise.all([loadProfile(), loadProfile()]);
    expect(a).toEqual(first);
    expect(b).toEqual(first);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("discards an old in-flight response after logout or account switching", async () => {
    let finishOld!: (response: Response) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(Response.json(second));
    vi.stubGlobal("fetch", fetch);
    const oldRequest = loadProfile();
    resetAccessProfileCache();
    expect(await loadProfile()).toEqual(second);
    finishOld(Response.json(first));
    expect(await oldRequest).toBeNull();
    expect(await loadProfile()).toEqual(second);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
