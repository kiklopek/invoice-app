export type AccessRole = "viewer" | "accounting" | "admin";

export function canManageInvoices(role: AccessRole | null) {
  return role === "accounting" || role === "admin";
}

export function canAccessPage(role: AccessRole | null, pathname: string) {
  if (role !== "viewer") return true;
  const isInvoiceDetail = /^\/invoices\/[0-9a-f-]{36}$/i.test(pathname);
  if (isInvoiceDetail) return true;
  return ["/dashboard", "/reports", "/invoices/archive"].some(
    path => pathname === path || pathname.startsWith(`${path}/`)
  );
}

export function isAccessRole(value: unknown): value is AccessRole {
  return value === "viewer" || value === "accounting" || value === "admin";
}
