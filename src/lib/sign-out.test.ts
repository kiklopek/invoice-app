import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasConfig: vi.fn(() => true),
  browserSignOut: vi.fn(),
}));

vi.mock("@/lib/supabase-browser", () => ({
  hasSupabaseBrowserConfig: mocks.hasConfig,
  createClient: () => ({ auth: { signOut: mocks.browserSignOut } }),
}));

import { signOutAllSessions, signOutCurrentSession } from "./sign-out";

describe("signOutCurrentSession", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.hasConfig.mockReturnValue(true);
    mocks.browserSignOut.mockReset();
  });

  it("uses the server logout route first", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await signOutCurrentSession();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    expect(mocks.browserSignOut).not.toHaveBeenCalled();
  });

  it("clears the browser session when the server route is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    mocks.browserSignOut.mockResolvedValue({ error: null });

    await signOutCurrentSession();

    expect(mocks.browserSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("reports an error when neither logout path succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    mocks.browserSignOut.mockResolvedValue({ error: new Error("auth failed") });

    await expect(signOutCurrentSession()).rejects.toThrow("Odhlášení se nepodařilo");
  });
  it("requests global revocation for every user session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await signOutAllSessions();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "global" }),
    });
  });

  it("reports a global revocation failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    await expect(signOutAllSessions()).rejects.toThrow();
  });
});
