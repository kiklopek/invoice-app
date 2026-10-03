import { createHash } from "node:crypto";
import { SaxesParser } from "saxes";
import { minorUnits } from "./money";
import { normalizePayerAccount } from "./payment-assistance";
import { MAX_GPC_IMPORT_ROWS, type PaymentImportRow } from "./payment-import";
import type { GpcParseResult, GpcPreviewEntry } from "./gpc-parser";
import { czechAccountToIban } from "./czech-payment";

// Candidate KB profile based on KB's public specification. Remains behind the
// separate real-sample-verification gate; these fixtures do not certify KB+.
export const KB_CAMT_NAMESPACE = "urn:iso:std:iso:20022:tech:xsd:camt.053.001.02";
type Element = { name: string; uri: string; attrs: Record<string,string>; text: string; children: Element[] };
const children = (node: Element, name: string) => node.children.filter(c => c.name === name);
function path(node: Element, names: string): Element | undefined {
  let current: Element | undefined = node;
  for (const name of names.split("/")) current = current?.children.find(c => c.name === name);
  return current;
}
const value = (node: Element, names: string) => path(node,names)?.text.trim() ?? "";
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function verifiedAccount(raw: string) {
  const clean = raw.replace(/\s/g,"").toUpperCase();
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(clean)) {
    const digits = (clean.slice(4)+clean.slice(0,4)).replace(/[A-Z]/g,c => String(c.charCodeAt(0)-55));
    let remainder = 0;
    for (const digit of digits) remainder = (remainder*10+Number(digit))%97;
    return remainder === 1;
  }
  return czechAccountToIban(clean) !== null;
}
function amount(node: Element | undefined) {
  if (!node || !/^\d+(?:\.\d{1,2})?$/.test(node.text.trim()) || !/^[A-Z]{3}$/.test(node.attrs.Ccy ?? "")) throw new Error("Neplatná částka nebo měna v XML.");
  const units = minorUnits(node.text.trim());
  if (units <= 0 || units > 99_999_999_999_999) throw new Error("Částka XML je mimo podporovaný rozsah.");
  return { units, currency: node.attrs.Ccy };
}
function realDate(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString().slice(0,10) !== raw) throw new Error("Neplatné datum XML.");
  return raw;
}
export function parseCamtStatement(bytes: Uint8Array): GpcParseResult {
  if (!bytes.length || bytes.length > 5*1024*1024) throw new Error("XML výpis musí mít nejvýše 5 MB.");
  const xml = new TextDecoder("utf-8", { fatal:true }).decode(bytes).replace(/^\uFEFF/, "");
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) throw new Error("XML s DTD nebo externími entitami není povoleno.");
  const parser = new SaxesParser({ xmlns:true });
  const stack: Element[] = [];
  let root: Element | undefined, count = 0;
  parser.on("opentag", tag => {
    if (++count > 100_000 || stack.length >= 64) throw new Error("XML výpis je příliš složitý.");
    if (tag.uri !== KB_CAMT_NAMESPACE) throw new Error("Nepodporovaná varianta CAMT.053; parser podporuje profil camt.053.001.02.");
    const node: Element = { name:tag.local, uri:tag.uri, attrs:Object.fromEntries(Object.values(tag.attributes).map(a => [a.local,a.value])), text:"", children:[] };
    if (stack.length) stack[stack.length-1].children.push(node); else { if (root) throw new Error("Více XML dokumentů."); root=node; }
    stack.push(node);
  });
  const append = (text: string) => { if (stack.length) stack[stack.length-1].text += text; };
  parser.on("text",append); parser.on("cdata",append);
  parser.on("closetag",() => { stack.pop(); });
  parser.on("doctype",() => { throw new Error("DTD není povoleno."); });
  parser.on("error",error => { throw error; });
  parser.write(xml).close();
  if (!root || (root as Element).name !== "Document") throw new Error("Chybí CAMT Document.");
  const document = root as Element;
  const bank = path(document,"BkToCstmrStmt");
  const statements = bank ? children(bank,"Stmt") : [];
  if (statements.length !== 1) throw new Error("První verze podporuje jeden výpis a jeden účet v souboru.");
  const statement = statements[0];
  const accountRaw = value(statement,"Acct/Id/IBAN") || value(statement,"Acct/Id/Othr/Id");
  if (!accountRaw) throw new Error("XML výpis neobsahuje účet.");
  if (!verifiedAccount(accountRaw)) throw new Error("Účet XML výpisu neprošel kontrolou čísla účtu.");
  const statementAccount = normalizePayerAccount(accountRaw);
  const statementId = value(statement,"Id");
  if (!statementId) throw new Error("XML výpis neobsahuje identifikátor výpisu.");
  const entries: GpcPreviewEntry[] = [];
  const bankReferences = new Map<string, PaymentImportRow>();
  const add = (entry: Omit<GpcPreviewEntry,"line">) => {
    if (entries.length >= MAX_GPC_IMPORT_ROWS) throw new Error("XML výpis obsahuje příliš mnoho transakcí.");
    entries.push({ ...entry,line:entries.length+1 });
  };
  for (const [index,ntry] of children(statement,"Ntry").entries()) {
    const fingerprint = hash(`${statementAccount}:${statementId}:${index}:${JSON.stringify(ntry)}`);
    if (value(ntry,"CdtDbtInd") !== "CRDT" || value(ntry,"RvslInd") === "true" || value(ntry,"Sts") !== "BOOK") {
      add({ recordType:"camt053",fingerprint,disposition:"ignored",reason:"Odchozí, stornovaná nebo nezaúčtovaná položka." }); continue;
    }
    try {
      const booked = amount(path(ntry,"Amt"));
      const date = realDate(value(ntry,"BookgDt/Dt"));
      const transactions = children(ntry,"NtryDtls").flatMap(d => children(d,"TxDtls"));
      if (!transactions.length) throw new Error("Chybí detail transakce; položka vyžaduje kontrolu.");
      const individual = transactions.map(tx => {
        const txAmount = path(tx,"AmtDtls/TxAmt/Amt");
        return txAmount ? amount(txAmount) : transactions.length === 1 ? booked : null;
      });
      if (individual.some(a => !a || a.currency !== booked.currency) || individual.reduce((sum,a) => sum+(a?.units ?? 0),0) !== booked.units) throw new Error("Součet detailů dávky neodpovídá zaúčtované částce.");
      // Validate the complete entry before emitting any child transaction.
      const parsed = transactions.map((tx,at) => {
        const ref = value(tx,"Refs/AcctSvcrRef") || (transactions.length === 1 ? value(ntry,"AcctSvcrRef") : "");
        const bankReference = ref && !["NOTPROVIDED","NONREF","0"].includes(ref.toUpperCase()) ? ref : undefined;
        const endToEnd = value(tx,"Refs/EndToEndId");
        const vs = /^VS\d{1,20}$/.test(endToEnd) ? endToEnd.slice(2).replace(/^0+(?=\d)/,"") : "";
        const name = value(tx,"RltdPties/Dbtr/Nm");
        const account = value(tx,"RltdPties/DbtrAcct/Id/IBAN") || value(tx,"RltdPties/DbtrAcct/Id/Othr/Id");
        const note = children(path(tx,"RmtInf") ?? { ...tx,children:[] },"Ustrd").map(n => n.text.trim()).join("\n") || value(tx,"AddtlTxInf");
        if (name.length > 200 || note.length > 500 || account.length > 100 || (bankReference?.length ?? 0)>200) throw new Error("Detail XML překračuje délku podporovaných údajů.");
        const txFingerprint = hash(`${fingerprint}:${at}`);
        const payment: PaymentImportRow = { external_id:`camt-${bankReference ? hash(`${statementAccount}:${bankReference}`) : txFingerprint}`,
          booked_on:date,amount:individual[at]!.units/100,currency:booked.currency,variable_symbol:vs,
          counterparty_name:name || undefined,counterparty_account:account ? normalizePayerAccount(account) : undefined,
          note:note || undefined,bank_reference:bankReference,statement_account:statementAccount,
          counterparty_account_verified:account ? verifiedAccount(account) : false };
        return { recordType:"camt053",fingerprint:txFingerprint,disposition:"accepted" as const,payment,
          provenance:{ namespace:KB_CAMT_NAMESPACE,statement_id:statementId,entry_index:index,transaction_index:at,bank_reference:bankReference ?? null,end_to_end:endToEnd || null } };
      });
      for (const row of parsed) {
        const reference = row.payment.bank_reference;
        const previous = reference ? bankReferences.get(reference) : undefined;
        if (previous) {
          const duplicate = previous.amount === row.payment.amount && previous.currency === row.payment.currency && previous.booked_on === row.payment.booked_on;
          add({ recordType:row.recordType,fingerprint:row.fingerprint,provenance:row.provenance,
            disposition:duplicate ? "duplicate" : "error",reason:"Bankovní reference se v souboru opakuje; zkontrolujte původní položku." });
        } else {
          if (reference) bankReferences.set(reference,row.payment);
          add(row);
        }
      }
    } catch (cause) {
      add({ recordType:"camt053",fingerprint,disposition:"error",reason:cause instanceof Error ? cause.message : "Neplatný detail XML." });
    }
  }
  if (!entries.length) throw new Error("XML výpis neobsahuje žádné položky.");
  return { fileHash:hash(bytes),accountNumber:statementAccount,entries,payments:entries.flatMap(e => e.payment ? [e.payment] : []),totals:{ accepted:entries.filter(e => e.disposition==="accepted").length,ignored:entries.filter(e => e.disposition==="ignored" || e.disposition==="duplicate").length,errors:entries.filter(e => e.disposition==="error").length } };
}
