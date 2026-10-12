import { describe, expect, it } from "vitest";
import { clearCompanySettingsDrafts, companySettingsDraftKey } from "./company-settings-draft";

describe("company draft isolation", () => {
  it("separates both users and organizations and refuses an unscoped fallback", () => {
    expect(companySettingsDraftKey("org-a:user-a")).not.toBe(companySettingsDraftKey("org-a:user-b"));
    expect(companySettingsDraftKey("org-a:user-a")).not.toBe(companySettingsDraftKey("org-b:user-a"));
    expect(companySettingsDraftKey(undefined)).toBeNull();
  });

  it("clears only application drafts on successful logout, including legacy drafts", () => {
    const data = new Map([
      ["splatno:company-settings-draft", "legacy"],
      [companySettingsDraftKey("org-a:user-a")!, "private data"],
      [companySettingsDraftKey("org-b:user-b")!, "private data"],
      ["unrelated-app-state", "keep"],
    ]);
    clearCompanySettingsDrafts({
      get length() { return data.size; },
      key: (index) => [...data.keys()][index] ?? null,
      removeItem: (key) => { data.delete(key); },
    });
    expect([...data.entries()]).toEqual([["unrelated-app-state", "keep"]]);
  });
});
