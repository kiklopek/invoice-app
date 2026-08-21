export type AccessRole = "viewer" | "accounting" | "admin";

export function canManageInvoices(role: AccessRole | null) {
  return role === "accounting" || role === "admin";
}

export function canAccessOperations(role: AccessRole | null) {
  return canManageInvoices(role);
}

export function canViewCompanySettings(role: AccessRole | null) {
  return role === "accounting" || role === "admin";
}

export function canEditCompanySettings(role: AccessRole | null) {
  return role === "admin";
}

export function canManageMembers(role: AccessRole | null) {
  return role === "admin";
}

export function canAccessPage(role: AccessRole | null, pathname: string) {
  if (role === "accounting" || role === "admin") return true;
  if (role !== "viewer") return false;
  const isInvoiceDetail = /^\/invoices\/[0-9a-f-]{36}$/i.test(pathname);
  if (isInvoiceDetail) return true;
  return pathname === "/invoices";
}

export function landingPageForRole(role: AccessRole | null) {
  return role === "viewer" ? "/invoices" : "/dashboard";
}

export function isAccessRole(value: unknown): value is AccessRole {
  return value === "viewer" || value === "accounting" || value === "admin";
}
