"use client";

import { useEffect, useState } from "react";
import { isAccessRole, type AccessRole } from "@/lib/role-access";

let cachedRole: AccessRole | null = null;
let pendingRole: Promise<AccessRole | null> | null = null;

function loadRole() {
  if (!pendingRole) {
    pendingRole = fetch("/api/auth/access", { method: "POST" })
      .then(async response => {
        if (!response.ok) return null;
        const data = await response.json() as { role?: unknown };
        return isAccessRole(data.role) ? data.role : null;
      })
      .catch(() => null)
      .then(role => {
        cachedRole = role;
        pendingRole = null;
        return role;
      });
  }
  return pendingRole;
}

export function useAccessRole() {
  const [role, setRole] = useState<AccessRole | null>(cachedRole);

  useEffect(() => {
    let active = true;
    void loadRole().then(nextRole => {
      if (active) setRole(nextRole);
    });
    return () => { active = false; };
  }, []);

  return role;
}
