import { createHash } from "node:crypto";
import { minorUnits } from "./money";
import { normalizeVariableSymbol } from "./payment-import";
import { referencesInvoiceNumber } from "./statement-assignment";

export const ASSISTANCE_VERSION = "assistance-v1";
export type AssistancePayment = {
  id: string; organization_id: string; amount: number; allocated_amount: number;
  currency: string; booked_on: string; counterparty_account: string | null;
  counterparty_name: string | null; variable_symbol: string | null; note: string | null;
  eligible: boolean; account_verified: boolean;
};
export type AssistanceInvoice = {
  id: string; organization_id: string; amount: number; paid_amount: number; currency: string;
  counterparty_ico: string | null; counterparty_name: string; invoice_number: string;
  variable_symbol: string | null; issue_date: string; status: string;
};
export type PayerMemory = {
  id: string; organization_id: string; counterparty_ico: string; account: string | null;
  payer_name: string | null; reference: string | null; active: boolean; revision: number;
};
export type AssistanceAllocation = { payment_id: string; invoice_id: string; amount: number };
export type AssistanceProposal = {
  kind: "unique" | "ambiguous" | "waiting" | "complex";
  engine_version: string; payment_ids: string[]; invoice_ids: string[];
  allocations: AssistanceAllocation[]; reason: string; currency: string;
  memory_ids: string[]; snapshot: { payments: AssistancePayment[]; invoices: AssistanceInvoice[]; memories: PayerMemory[] };
  input_hash: string;
};
export function normalizePayerName(value: string | null) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export function normalizePayerAccount(value: string | null) {
  const raw = (value ?? "").replace(/\s/g, "").toUpperCase();
  if (/^CZ\d{22}$/.test(raw)) {
    const prefix = raw.slice(8, 14).replace(/^0+/, "");
    return `${prefix ? `${prefix}-` : ""}${raw.slice(14).replace(/^0+/, "") || "0"}/${raw.slice(4, 8)}`;
  }
  const match = /^(?:(\d{1,6})-)?(\d{1,10})\/(\d{4})$/.exec(raw);
  if (!match) return raw;
  const prefix = (match[1] ?? "").replace(/^0+/, "");
  return `${prefix ? `${prefix}-` : ""}${match[2].replace(/^0+/, "") || "0"}/${match[3]}`;
}

/** Integer max-flow; a directed alternating cycle proves a second allocation
 * exists, even when there is only one possible invoice subset. */
function allocationMatrix(supply: number[], demand: number[], allowed: boolean[][], tick: () => void) {
  const rows = supply.length, cols = demand.length, sink = rows + cols + 1, size = sink + 1;
  const cap = Array.from({ length: size }, () => Array<number>(size).fill(0));
  for (let r = 0; r < rows; r++) {
    cap[0][1 + r] = supply[r];
    for (let c = 0; c < cols; c++) if (allowed[r][c]) cap[1 + r][1 + rows + c] = Math.min(supply[r], demand[c]);
  }
  for (let c = 0; c < cols; c++) cap[1 + rows + c][sink] = demand[c];
  const original = cap.map(row => [...row]);
  let flow = 0;
  for (;;) {
    tick();
    const parent = Array<number>(size).fill(-1), queue = [0]; parent[0] = 0;
    for (let at = 0; at < queue.length && parent[sink] < 0; at++) {
      const u = queue[at];
      for (let v = 0; v < size; v++) if (parent[v] < 0 && cap[u][v] > 0) { parent[v] = u; queue.push(v); }
    }
    if (parent[sink] < 0) break;
    let add = Number.MAX_SAFE_INTEGER;
    for (let v = sink; v !== 0; v = parent[v]) add = Math.min(add, cap[parent[v]][v]);
    for (let v = sink; v !== 0; v = parent[v]) { cap[parent[v]][v] -= add; cap[v][parent[v]] += add; }
    flow += add;
  }
  if (flow !== supply.reduce((sum, v) => sum + v, 0)) return null;
  let ambiguous = false;
  const walk = (start: number, u: number, path: number[]) => {
    tick();
    if (ambiguous) return;
    for (let v = 1; v <= rows + cols; v++) {
      if (cap[u][v] <= 0 || v === path[path.length - 2]) continue;
      if (v === start && path.length >= 4) { ambiguous = true; return; }
      if (!path.includes(v)) walk(start, v, [...path, v]);
    }
  };
  for (let u = 1; u <= rows + cols && !ambiguous; u++) walk(u, u, [u]);
  return { ambiguous, matrix: supply.map((_, r) => demand.map((__, c) => original[1+r][1+rows+c] - cap[1+r][1+rows+c])) };
}

export function buildAssistanceProposals(
  rawPayments: AssistancePayment[], rawInvoices: AssistanceInvoice[], rawMemory: PayerMemory[], maximumStates = 100_000,
): AssistanceProposal[] {
  const output: AssistanceProposal[] = [];
  const invoices = rawInvoices.filter(i => ["pending", "overdue"].includes(i.status) && minorUnits(i.amount) > minorUnits(i.paid_amount));
  const make = (payments: AssistancePayment[], candidates: AssistanceInvoice[], memory: PayerMemory[], kind: AssistanceProposal["kind"], reason: string, allocations: AssistanceAllocation[] = []) => {
    const snapshot = { payments: [...payments].sort((a,b) => a.id.localeCompare(b.id)), invoices: [...candidates].sort((a,b) => a.id.localeCompare(b.id)), memories: [...memory].sort((a,b) => a.id.localeCompare(b.id)) };
    return { kind, reason, engine_version: ASSISTANCE_VERSION, payment_ids: payments.map(p => p.id), invoice_ids: candidates.map(i => i.id), allocations, currency: payments[0].currency, memory_ids: memory.map(m => m.id), snapshot, input_hash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") };
  };
  type Group = { payments: AssistancePayment[]; invoices: AssistanceInvoice[]; memories: PayerMemory[]; edges: Map<string, Set<string>> };
  const groups = new Map<string, Group>();
  for (const p of [...rawPayments].sort((a,b) => a.id.localeCompare(b.id))) {
    if (!p.eligible || minorUnits(p.amount) <= minorUnits(p.allocated_amount)) continue;
    const open = invoices.filter(i => i.organization_id === p.organization_id && i.currency === p.currency && i.issue_date <= p.booked_on);
    const vs = normalizeVariableSymbol(p.variable_symbol);
    const closedReference = rawInvoices.some(i => i.organization_id === p.organization_id && i.currency === p.currency && !["pending","overdue"].includes(i.status) && (
      (vs && normalizeVariableSymbol(i.variable_symbol || (/^\d+$/.test(i.invoice_number) ? i.invoice_number : "")) === vs) || referencesInvoiceNumber(p.note,i.invoice_number)
    ));
    if (closedReference) { output.push(make([p],[],[],"ambiguous","Platba odkazuje na již uzavřenou fakturu. Ověřte duplicitní úhradu nebo jiný záměr plátce.")); continue; }
    const byVs = vs ? open.filter(i => normalizeVariableSymbol(i.variable_symbol || (/^\d+$/.test(i.invoice_number) ? i.invoice_number : "")) === vs) : [];
    const byNote = open.filter(i => referencesInvoiceNumber(p.note, i.invoice_number));
    const memories = rawMemory.filter(m => m.active && m.organization_id === p.organization_id && (
      (p.account_verified && m.account && normalizePayerAccount(m.account) === normalizePayerAccount(p.counterparty_account)) ||
      (m.payer_name && normalizePayerName(m.payer_name) === normalizePayerName(p.counterparty_name)) ||
      (m.reference && p.note && p.note.trim().toUpperCase() === m.reference.trim().toUpperCase())
    ));
    const identities = new Set([...byVs, ...byNote].map(i => i.counterparty_ico).filter(Boolean));
    const memoryIdentities = new Set(memories.map(m => m.counterparty_ico));
    if (byVs.length > 1 || identities.size > 1 || memoryIdentities.size > 1 || (byVs.length && byNote.length && byNote.some(i => !byVs.some(v => v.id === i.id))) || (identities.size && memoryIdentities.size && [...identities][0] !== [...memoryIdentities][0])) {
      output.push(make([p], [...new Map([...byVs,...byNote].map(i => [i.id,i])).values()], memories, "ambiguous", "Reference nebo potvrzená identita plátce si odporují.")); continue;
    }
    const ico = [...identities][0] ?? [...memoryIdentities][0];
    if (!ico) { output.push(make([p], [], memories, "waiting", "Chybí doložená identita nebo odpovídající faktura. Můžete označit čekání na fakturu.")); continue; }
    const key = `${p.organization_id}:${p.currency}:${ico}`;
    const group: Group = groups.get(key) ?? { payments: [], invoices: invoices.filter(i => i.organization_id === p.organization_id && i.currency === p.currency && i.counterparty_ico === ico), memories: [], edges: new Map() };
    group.payments.push(p); group.memories.push(...memories);
    const explicit = [...byVs, ...byNote];
    group.edges.set(p.id, new Set((explicit.length ? explicit : open.filter(i => i.counterparty_ico === ico)).map(i => i.id)));
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const { payments, invoices: candidates, edges } = group;
    const memories = [...new Map(group.memories.map(m => [m.id,m])).values()];
    if (payments.length > 12 || candidates.length > 32) { output.push(make(payments, candidates, memories, "complex", "Skupina přesahuje bezpečný limit hledání.")); continue; }
    let visited = 0;
    const tick = () => { if (++visited > maximumStates) throw new Error("search_limit"); };
    const found: AssistanceProposal[] = [];
    try {
      for (let mask = 1; mask < 2 ** payments.length; mask++) {
        tick();
        const selectedPayments = payments.filter((_,i) => mask & (1 << i));
        const supply = selectedPayments.map(p => minorUnits(p.amount) - minorUnits(p.allocated_amount));
        const target = supply.reduce((sum,v) => sum+v,0);
        const suffix = Array<number>(candidates.length+1).fill(0);
        for (let i=candidates.length-1;i>=0;i--) suffix[i] = suffix[i+1] + minorUnits(candidates[i].amount)-minorUnits(candidates[i].paid_amount);
        const search = (at: number, sum: number, selected: AssistanceInvoice[]) => {
          tick();
          if (sum === target) {
            const demand = selected.map(i => minorUnits(i.amount)-minorUnits(i.paid_amount));
            const matrix = allocationMatrix(supply,demand,selectedPayments.map(p => selected.map(i => edges.get(p.id)!.has(i.id))),tick);
            if (matrix) {
              const allocations = selectedPayments.flatMap((p,r) => selected.flatMap((i,c) => matrix.matrix[r][c] > 0 ? [{ payment_id:p.id,invoice_id:i.id,amount:matrix.matrix[r][c]/100 }] : []));
              found.push(make(selectedPayments,selected,memories,matrix.ambiguous ? "ambiguous" : "unique",matrix.ambiguous ? "Součet sedí, ale existuje více rozdělení částek mezi faktury." : "Jednoznačné rozdělení přesných zůstatků podle doložené identity a referencí; potvrďte přiřazení.",allocations));
            }
            return;
          }
          if (at >= candidates.length || sum > target || sum + suffix[at] < target) return;
          search(at+1,sum+minorUnits(candidates[at].amount)-minorUnits(candidates[at].paid_amount),[...selected,candidates[at]]);
          search(at+1,sum,selected);
        };
        search(0,0,[]);
      }
      // A superset with identical allocations adds no alternative. Prefer the
      // complete group, then demote any genuinely competing allocations.
      const maximal = found.filter(p => !found.some(q => q !== p && q.allocations.length > p.allocations.length && p.allocations.every(a => q.allocations.some(b => JSON.stringify(a) === JSON.stringify(b)))));
      for (const p of maximal) if (maximal.some(q => q !== p && p.payment_ids.some(id => q.payment_ids.includes(id)) || q !== p && p.invoice_ids.some(id => q.invoice_ids.includes(id)))) { p.kind = "ambiguous"; p.reason = "Existuje více konkurenčních kombinací plateb a faktur."; }
      output.push(...maximal);
      const covered = new Set(maximal.flatMap(p => p.payment_ids));
      for (const p of payments.filter(p => !covered.has(p.id))) output.push(make([p],candidates,memories,"waiting","Identita plátce je známá, ale přesná kombinace chybí. Může chybět faktura nebo jít o jiný typ úhrady."));
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "search_limit") throw error;
      output.push(make(payments,candidates,memories,"complex","Hledání překročilo limit; žádná nalezená část se nepovažuje za jednoznačnou."));
    }
  }
  return output;
}
