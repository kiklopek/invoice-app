// A presentation preference for this browser tab; no chat or invoice data.
export const ESKO_MINIMIZED_KEY = "splatno:esko:minimized:v1";
const CHANGE_EVENT = "splatno:esko-visibility";
let memoryMinimized = false;
let storageUnavailable = false;

export function readEskoMinimized() {
  if (typeof window === "undefined") return false;
  if (storageUnavailable) return memoryMinimized;
  try { return window.sessionStorage.getItem(ESKO_MINIMIZED_KEY) === "1"; }
  catch { return memoryMinimized; }
}

export function setEskoMinimized(minimized: boolean) {
  memoryMinimized = minimized;
  try {
    if (minimized) window.sessionStorage.setItem(ESKO_MINIMIZED_KEY, "1");
    else window.sessionStorage.removeItem(ESKO_MINIMIZED_KEY);
    storageUnavailable = false;
  } catch { storageUnavailable = true; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeEskoVisibility(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === ESKO_MINIMIZED_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}

export const eskoServerSnapshot = () => false;
export const eskoClientSnapshot = () => true;
export const subscribeEskoHydration = () => () => {};
