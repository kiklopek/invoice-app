import "server-only";
import type { AccessRole } from "./role-access";

export function canUseGpcImport(role: AccessRole) {
  if (process.env.GPC_IMPORT_ENABLED === "false") return false;
  const configured = (process.env.GPC_IMPORT_ROLES ?? "admin,accounting")
    .split(",")
    .map((value) => value.trim());
  return configured.includes(role);
}
