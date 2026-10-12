const PREFIX = "splatno:company-settings-draft";

/** The scope is issued by the authenticated server loader, never a form value. */
export function companySettingsDraftKey(scope: string | undefined) {
  return scope ? `${PREFIX}:${scope}` : null;
}

export function clearCompanySettingsDrafts(storage: Pick<Storage, "length" | "key" | "removeItem">) {
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key === PREFIX || key?.startsWith(`${PREFIX}:`)) storage.removeItem(key);
  }
}
