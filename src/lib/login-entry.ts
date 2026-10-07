// Odkud se člověk přihlásil: obecné /login, nebo vstup R. Hlavica /hlavica.
// Po odhlášení se vrátí tam, odkud přišel (P10). Je to jen pohodlí pro
// vzhled, ne bezpečnost -- proto stačí úložiště prohlížeče.

export type LoginEntry = "/login" | "/hlavica";
const KEY = "splatno:login-entry";

export function rememberLoginEntry(entry: LoginEntry) {
  try {
    window.localStorage.setItem(KEY, entry);
  } catch {
    // Bez úložiště se po odhlášení ukáže obecné přihlášení.
  }
}

export function loginEntryPath(): LoginEntry {
  try {
    return window.localStorage.getItem(KEY) === "/hlavica" ? "/hlavica" : "/login";
  } catch {
    return "/login";
  }
}
