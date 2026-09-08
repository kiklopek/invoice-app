"use client";

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { isAccessRole, type AccessRole } from "@/lib/role-access";

export type AccessProfile = {
  role: AccessRole;
  name: string;
  email: string;
  companyName: string;
};

let cachedProfile: AccessProfile | null = null;
let pendingProfile: Promise<AccessProfile | null> | null = null;
let profileExpiresAt = 0;
const PROFILE_TTL_MS = 30_000;
const AccessProfileContext = createContext<AccessProfile | null | undefined>(undefined);

export function AccessProfileProvider({ profile, children }: { profile: AccessProfile | null; children: ReactNode }) {
  useEffect(() => {
    cachedProfile = profile;
    profileExpiresAt = profile ? Date.now() + PROFILE_TTL_MS : 0;
    pendingProfile = null;
  }, [profile]);
  return createElement(AccessProfileContext.Provider, { value: profile }, children);
}

// Presentation only: every API request still checks the current server permissions.
export function loadProfile() {
  if (cachedProfile && Date.now() < profileExpiresAt) {
    return Promise.resolve(cachedProfile);
  }
  if (!pendingProfile) {
    pendingProfile = fetch("/api/auth/access", { method: "POST", signal: AbortSignal.timeout(15_000) })
      .then(async response => {
        if (!response.ok) return null;
        const data = await response.json() as { role?: unknown; name?: unknown; email?: unknown; companyName?: unknown };
        if (!isAccessRole(data.role) || typeof data.name !== "string" || typeof data.email !== "string" || typeof data.companyName !== "string") return null;
        return { role: data.role, name: data.name, email: data.email, companyName: data.companyName };
      })
      .catch(() => null)
      .then(profile => {
        cachedProfile = profile;
        profileExpiresAt = profile ? Date.now() + PROFILE_TTL_MS : 0;
        pendingProfile = null;
        return profile;
      });
  }
  return pendingProfile;
}

export function useAccessProfile(initialProfile: AccessProfile | null = null) {
  const providedProfile = useContext(AccessProfileContext);
  const seededProfile = providedProfile !== undefined ? providedProfile : initialProfile ?? cachedProfile;
  const [profile, setProfile] = useState<AccessProfile | null>(seededProfile);

  useEffect(() => {
    if (providedProfile !== undefined) {
      setProfile(providedProfile);
      return;
    }
    if (initialProfile) {
      cachedProfile = initialProfile;
      profileExpiresAt = Date.now() + PROFILE_TTL_MS;
      setProfile(initialProfile);
      return;
    }
    let active = true;
    void loadProfile().then(nextProfile => {
      if (active) setProfile(nextProfile);
    });
    return () => { active = false; };
  }, [initialProfile, providedProfile]);

  return profile;
}

export function useAccessRole() {
  return useAccessProfile()?.role ?? null;
}
