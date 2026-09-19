export type AccessRole = "viewer" | "accounting" | "admin";

export const roleNames: Record<AccessRole, string> = {
  admin: "Administrátor",
  accounting: "Účetní",
  viewer: "Čtenář",
};

export function canManageInvoices(role: AccessRole | null) {
  return role === "accounting" || role === "admin";
}

export function canAccessOperations(role: AccessRole | null) {
  return canManageInvoices(role);
}

export function canViewFinancialInsights(role: AccessRole | null) {
  return role === "viewer" || role === "accounting" || role === "admin";
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

// Single source of truth for what a viewer may open. Used both to gate a
// direct page load (canAccessPage below) and to decide what the navigation
// even shows a viewer (app-shell.tsx) -- those two used to be independently
// maintained lists that happened to agree by coincidence, which is exactly
// the kind of thing that silently drifts apart the next time someone adds a
// nav item without touching this file (or vice versa).
export const VIEWER_ALLOWED_PATHS = ["/dashboard", "/invoices", "/reports", "/customers"] as const;

export function canAccessPage(role: AccessRole | null, pathname: string) {
  if (role === "accounting" || role === "admin") return true;
  if (role !== "viewer") return false;
  const isInvoiceDetail = /^\/invoices\/[0-9a-f-]{36}$/i.test(pathname);
  if (isInvoiceDetail) return true;
  return (VIEWER_ALLOWED_PATHS as readonly string[]).includes(pathname);
}

export function landingPageForRole(role: AccessRole | null) {
  return role ? "/dashboard" : "/login";
}

export function isAccessRole(value: unknown): value is AccessRole {
  return value === "viewer" || value === "accounting" || value === "admin";
}
