import { describe, expect, it } from "vitest";
import { parseCamtStatement } from "./camt-statement-parser";
const tx = (amount = "100.18", ref = "bank-001", name = "Celé jméno plátce s.r.o.") => `<TxDtls><Refs><AcctSvcrRef>${ref}</AcctSvcrRef><EndToEndId>VS1001</EndToEndId></Refs><AmtDtls><TxAmt><Amt Ccy="CZK">${amount}</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>${name}</Nm></Dbtr><DbtrAcct><Id><IBAN>CZ6508000000192000145399</IBAN></Id></DbtrAcct></RltdPties><RmtInf><Ustrd>Úhrada faktury 1001</Ustrd></RmtInf></TxDtls>`;
const xml = (details = tx(), amount = "100.18", ns = "urn:iso:std:iso:20022:tech:xsd:camt.053.001.02") => `<Document xmlns="${ns}"><BkToCstmrStmt><Stmt><Id>KB-test</Id><Acct><Id><IBAN>CZ6508000000192000145399</IBAN></Id><Ccy>CZK</Ccy></Acct><Ntry><Amt Ccy="CZK">${amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-01</Dt></BookgDt><NtryDtls>${details}</NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`;
const parse = (value: string) => parseCamtStatement(new TextEncoder().encode(value));
describe("KB camt.053.001.02 candidate parser (synthetic fixtures)", () => {
  it("preserves full names, messages, VS and reliable bank references", () => {
    const result = parse(xml());
    expect(result.payments[0]).toMatchObject({ amount:100.18,variable_symbol:"1001",counterparty_name:"Celé jméno plátce s.r.o.",note:"Úhrada faktury 1001",bank_reference:"bank-001" });
    expect(result.entries[0].provenance?.namespace).toContain("053.001.02");
  });
  it("rejects DTD, external entities, malformed XML, unsupported namespace and non-UTF8", () => {
    expect(() => parse(`<!DOCTYPE Document [<!ENTITY x SYSTEM "file:///etc/passwd">]>${xml()}`)).toThrow();
    expect(() => parse(xml().replace("Úhrada", "&evil;"))).toThrow();
    expect(() => parse(xml().replace("</Document>", ""))).toThrow();
    expect(() => parse(xml(tx(),"100.18","urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"))).toThrow(/varianta/);
    expect(() => parseCamtStatement(new Uint8Array([255]))).toThrow();
  });
  it("splits a batch only when individual booked amounts sum exactly", () => {
    expect(parse(xml(tx("40","a")+tx("60.18","b"))).payments).toHaveLength(2);
    const invalid = parse(xml(tx("40","a")+tx("60","b")));
    expect(invalid.payments).toHaveLength(0);
    expect(invalid.totals.errors).toBe(1);
  });
  it("does not substitute an instructed foreign-currency amount", () => {
    const result = parse(xml(tx().replace('<TxAmt><Amt Ccy="CZK">100.18</Amt></TxAmt>', '<InstdAmt><Amt Ccy="EUR">4.00</Amt></InstdAmt>')));
    expect(result.payments[0].amount).toBe(100.18);
    expect(result.payments[0].currency).toBe("CZK");
  });
  it("deduplicates repeated bank references within a file and exposes conflicting amounts", () => {
    const duplicate = parse(xml(tx("50","same")+tx("50","same"),"100"));
    expect(duplicate.payments).toHaveLength(1);
    expect(duplicate.entries[1].disposition).toBe("duplicate");
    const conflict = parse(xml(tx("40","same")+tx("60","same"),"100"));
    expect(conflict.entries[1].disposition).toBe("error");
  });
  it("ignores outgoing, reversed and pending entries", () => {
    expect(parse(xml().replace("CRDT","DBIT")).payments).toHaveLength(0);
    expect(parse(xml().replace("<Sts>BOOK</Sts>","<Sts>PDNG</Sts>")).payments).toHaveLength(0);
    expect(parse(xml().replace("<Sts>","<RvslInd>true</RvslInd><Sts>")).payments).toHaveLength(0);
  });
  it("does not treat end-to-end identifiers or absent references as bank identity", () => {
    const result = parse(xml(tx().replace("<AcctSvcrRef>bank-001</AcctSvcrRef>","")));
    expect(result.payments[0].bank_reference).toBeUndefined();
  });
  it("rejects multiple statement accounts and overprecision instead of guessing", () => {
    expect(() => parse(xml().replace("</BkToCstmrStmt>","<Stmt/></BkToCstmrStmt>"))).toThrow();
    expect(parse(xml(tx("100.181"),"100.181")).payments).toHaveLength(0);
  });
});
