import { describe, expect, it, vi } from "vitest";
import { fakeChain, fakeIdentity } from "@/app/api/payments/__test-helpers__";
import { loadSettingsPageData } from "./settings-page-data";
import type { RequestIdentity } from "./auth";

function fixture(role: "admin" | "accounting" | "viewer") {
  const company = {
    name: "Fixture", settings_revision: 3, allowed_email_domain: null,
    bank_accounts: [
      { id: "b", account: "second", currency: "EUR", label: null, created_at: "2026-02-01" },
      { id: "a", account: "first", currency: "CZK", label: null, created_at: "2026-01-01" },
    ],
  };
  const select = vi.fn();
  const from = vi.fn((table: string) => {
    const chain = fakeChain({ data: table === "organizations" ? company : [], error: null });
    return { select: (columns: string) => { select(columns); return chain; } };
  });
  return { identity: fakeIdentity({ role, service: { from } }) as unknown as RequestIdentity, from, select };
}

describe("settings composite loader", () => {
  it("returns bank accounts in the company query without a separate round trip", async () => {
    const { identity, from, select } = fixture("admin");
    const data = await loadSettingsPageData(identity);
    expect(from.mock.calls.map(([table]) => table)).toEqual(["organizations", "organization_members", "organization_member_events", "support_sessions"]);
    expect(select).toHaveBeenCalledWith(expect.stringContaining("bank_accounts:organization_bank_accounts("));
    expect(data.bank_accounts.map((account) => account.id)).toEqual(["a", "b"]);
    expect(data.bank_accounts[0]).not.toHaveProperty("created_at");
    expect(data.company).not.toHaveProperty("bank_accounts");
    expect(data.company.revision).toBe(3);
  });

  it("does not load members, audit history or support sessions for accounting", async () => {
    const { identity, from } = fixture("accounting");
    const data = await loadSettingsPageData(identity);
    expect(from).toHaveBeenCalledTimes(1);
    expect(data.members).toEqual([]);
    expect(data.access_events).toEqual([]);
    expect(data.support_sessions).toEqual([]);
    expect(data.bank_accounts).toHaveLength(2);
  });

  it("denies anonymous and reader access before querying", async () => {
    const { identity, from } = fixture("viewer");
    await expect(loadSettingsPageData(null)).rejects.toMatchObject({ status: 401 });
    await expect(loadSettingsPageData(identity)).rejects.toMatchObject({ status: 403 });
    expect(from).not.toHaveBeenCalled();
  });
});
