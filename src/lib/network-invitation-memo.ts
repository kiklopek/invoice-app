"use client";

// Pozvánka do sítě, ke které se má uživatel vrátit po registraci nebo
// přihlášení. Jen odkaz v tomto prohlížeči -- nic se tím nepropojuje; propojit
// může až přihlášený admin kliknutím na stránce pozvánky.
const KEY = "splatno:network-invitation";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type RememberedNetworkInvitation = { token: string; inviter: string; savedAt: number };

export function rememberNetworkInvitation(token: string, inviter: string) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ token, inviter, savedAt: Date.now() }));
  } catch {
    // Bez úložiště se pozvánka jen nepřipomene.
  }
}

export function readNetworkInvitation(): RememberedNetworkInvitation | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<RememberedNetworkInvitation> | null;
    if (!value || typeof value.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.token)) return null;
    if (typeof value.savedAt !== "number" || Date.now() - value.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return { token: value.token, inviter: typeof value.inviter === "string" ? value.inviter.slice(0, 200) : "", savedAt: value.savedAt };
  } catch {
    return null;
  }
}

export function forgetNetworkInvitation() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nic.
  }
}
