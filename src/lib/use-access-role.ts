"use client";

import { useEffect, useState } from "react";
import { isAccessRole, type AccessRole } from "@/lib/role-access";

export type AccessProfile = {
  role: AccessRole;
  name: string;
  email: string;
  companyName: string;
};

let cachedProfile: AccessProfile | null = null;
let pendingProfile: Promise<AccessProfile | null> | null = null;

function loadProfile() {
  if (!pendingProfile) {
    pendingProfile = fetch("/api/auth/access", { method: "POST" })
      .then(async response => {
        if (!response.ok) return null;
        const data = await response.json() as { role?: unknown; name?: unknown; email?: unknown; companyName?: unknown };
        if (!isAccessRole(data.role) || typeof data.name !== "string" || typeof data.email !== "string" || typeof data.companyName !== "string") return null;
        return { role: data.role, name: data.name, email: data.email, companyName: data.companyName };
      })
      .catch(() => null)
      .then(profile => {
        cachedProfile = profile;
        pendingProfile = null;
        return profile;
      });
  }
  return pendingProfile;
}

export function useAccessProfile() {
  const [profile, setProfile] = useState<AccessProfile | null>(cachedProfile);

  useEffect(() => {
    let active = true;
    void loadProfile().then(nextProfile => {
      if (active) setProfile(nextProfile);
    });
    return () => { active = false; };
  }, []);

  return profile;
}

export function useAccessRole() {
  return useAccessProfile()?.role ?? null;
}
