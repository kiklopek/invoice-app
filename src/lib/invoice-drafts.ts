import type { InvoiceInput } from "@/types/invoice";

// Rozepsana faktura drive zila jen v Map v pameti modulu, takze ji smazl
// kazdy reload, prechod na jinou stranku i vyprsena session (api-client
// v takovem pripade presmeruje na /login). Uzivatel pritom mohl mit
// vyplnenych patnact poli.
//
// Ulozene je to proto v sessionStorage: prezije reload i navigaci, ale
// zmizi se zavrenim panelu a nikdy neopusti prohlizec. localStorage by
// fakturacni data nechal lezet na disku i po odhlaseni, coz je horsi.
const STORAGE_KEY = "splatno:invoice-drafts";
const MAX_DRAFTS = 20;
// Verze schematu: kdyz se InvoiceInput zmeni, stara rozepsana data se
// zahodi misto toho, aby se do formulare nacetl nekompatibilni tvar.
const SCHEMA_VERSION = 1;

type DraftStore = { version: number; drafts: Record<string, InvoiceInput>; order: string[] };

const emptyStore = (): DraftStore => ({ version: SCHEMA_VERSION, drafts: {}, order: [] });

// Zaloha pro prostredi bez sessionStorage (SSR, testy, privatni rezim
// s blokovanym ulozistem). Chovani zustava stejne, jen bez trvanlivosti.
let memoryFallback: DraftStore = emptyStore();

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    // Pristup muze v nekterych rezimech prohlizece rovnou vyhodit vyjimku.
    return null;
  }
}

function readStore(): DraftStore {
  const store = storage();
  if (!store) return memoryFallback;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as DraftStore;
    if (parsed?.version !== SCHEMA_VERSION || typeof parsed.drafts !== "object" || !Array.isArray(parsed.order)) {
      return emptyStore();
    }
    return parsed;
  } catch {
    // Poskozeny obsah je stejne nepouzitelny jako zadny.
    return emptyStore();
  }
}

function writeStore(next: DraftStore) {
  const store = storage();
  if (!store) {
    memoryFallback = next;
    return;
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Plne uloziste nesmi shodit rozepsany formular -- drzi se aspon v pameti.
    memoryFallback = next;
  }
}

export function readInvoiceDraft(key: string) {
  const draft = readStore().drafts[key];
  return draft ? { ...draft } : undefined;
}

export function saveInvoiceDraft(key: string, draft: InvoiceInput) {
  const store = readStore();
  const order = store.order.filter(existing => existing !== key);
  order.push(key);
  const drafts = { ...store.drafts, [key]: { ...draft } };
  while (order.length > MAX_DRAFTS) {
    const oldest = order.shift()!;
    delete drafts[oldest];
  }
  writeStore({ version: SCHEMA_VERSION, drafts, order });
}

export function clearInvoiceDraft(key: string) {
  const store = readStore();
  if (!(key in store.drafts)) return;
  const drafts = { ...store.drafts };
  delete drafts[key];
  writeStore({ version: SCHEMA_VERSION, drafts, order: store.order.filter(existing => existing !== key) });
}
