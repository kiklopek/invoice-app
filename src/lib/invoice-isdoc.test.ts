import { describe, expect, it } from "vitest";
import { isdocToExactReading, parseIsdoc } from "./invoice-isdoc";

const organization = { name: "M. Kolar, s.r.o.", ico: "16180330", dic: "CZ16180330" };

function isdoc({ documentType = "1", customerIco = "46692011", foreign = false, secondRate = false } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- vzorový ISDOC 6.0.2 -->
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
  <DocumentType>${documentType}</DocumentType>
  <ID>1443260157</ID>
  <UUID>6A7F2C1E-1111-2222-3333-444455556666</UUID>
  <IssueDate>2026-09-15</IssueDate>
  <TaxPointDate>2026-09-15</TaxPointDate>
  <VATApplicable>true</VATApplicable>
  <Note><![CDATA[Vystaveno zákazníkem <samofakturace>]]></Note>
  <LocalCurrencyCode>CZK</LocalCurrencyCode>
  ${foreign ? "<ForeignCurrencyCode>EUR</ForeignCurrencyCode>" : ""}
  <CurrRate>1</CurrRate>
  <RefCurrRate>1</RefCurrRate>
  <AccountingSupplierParty><Party>
    <PartyIdentification><ID>16180330</ID></PartyIdentification>
    <PartyName><Name>M. Kolar, s.r.o.</Name></PartyName>
    <PartyTaxScheme><CompanyID>CZ16180330</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme>
  </Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party>
    <PartyIdentification><ID>${customerIco}</ID></PartyIdentification>
    <PartyName><Name>TIMBER &amp; PULP a.s.</Name></PartyName>
    <PostalAddress><StreetName>Hlína</StreetName><BuildingNumber>138</BuildingNumber><CityName>Ivančice</CityName><PostalZone>66491</PostalZone></PostalAddress>
    <PartyTaxScheme><CompanyID>CZ${customerIco}</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme>
    <Contact><ElectronicMail>katerina.novakova@timber-pulp.cz</ElectronicMail></Contact>
  </Party></AccountingCustomerParty>
  <TaxTotal>
    <TaxSubTotal>
      <TaxableAmount>101735.70</TaxableAmount>
      <TaxAmount>21364.50</TaxAmount>
      <TaxInclusiveAmount>123100.20</TaxInclusiveAmount>
      <TaxCategory><Percent>21</Percent></TaxCategory>
    </TaxSubTotal>
    ${secondRate ? "<TaxSubTotal><TaxableAmount>1000</TaxableAmount><TaxAmount>120</TaxAmount><TaxInclusiveAmount>1120</TaxInclusiveAmount><TaxCategory><Percent>12</Percent></TaxCategory></TaxSubTotal>" : ""}
    <TaxAmount>21364.50</TaxAmount>
  </TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount>101735.70</TaxExclusiveAmount>
    ${foreign ? "<TaxExclusiveAmountCurr>4069.43</TaxExclusiveAmountCurr>" : ""}
    <TaxInclusiveAmount>123100.20</TaxInclusiveAmount>
    ${foreign ? "<TaxInclusiveAmountCurr>4924.01</TaxInclusiveAmountCurr>" : ""}
    <PaidDepositsAmount>0</PaidDepositsAmount>
    <PayableAmount>123100.20</PayableAmount>
    ${foreign ? "<PayableAmountCurr>4924.01</PayableAmountCurr>" : ""}
  </LegalMonetaryTotal>
  <PaymentMeans><Payment>
    <PaidAmount>123100.20</PaidAmount>
    <PaymentMeansCode>42</PaymentMeansCode>
    <Details>
      <PaymentDueDate>2026-09-23</PaymentDueDate>
      <ID>6786420257</ID>
      <BankCode>0100</BankCode>
      <VariableSymbol>1443260157</VariableSymbol>
      <ConstantSymbol>0008</ConstantSymbol>
    </Details>
  </Payment></PaymentMeans>
</Invoice>`;
}

describe("ISDOC -- strojově čitelná faktura vložená v PDF", () => {
  it("přečte číslo, VS, data, částky, DPH i identitu odběratele", () => {
    const parsed = parseIsdoc(isdoc());
    expect(parsed).toMatchObject({
      documentType: "1",
      invoiceNumber: "1443260157",
      issueDate: "2026-09-15",
      dueDate: "2026-09-23",
      variableSymbol: "1443260157",
      currency: "CZK",
      taxExclusiveAmount: 101735.7,
      taxInclusiveAmount: 123100.2,
      payableAmount: 123100.2,
      vatRates: [21],
      supplier: { ico: "16180330", dic: "CZ16180330", name: "M. Kolar, s.r.o." },
      customer: { ico: "46692011", dic: "CZ46692011", name: "TIMBER & PULP a.s.", email: "katerina.novakova@timber-pulp.cz" },
    });
  });

  it("převede ISDOC na přesný zdroj pro formulář", () => {
    const reading = isdocToExactReading(parseIsdoc(isdoc())!, organization, "faktura.isdoc");
    expect(reading.method).toBe("isdoc");
    expect(reading.document_kind).toBe("issued_invoice");
    expect(reading.values).toEqual({
      invoice_number: "1443260157",
      variable_symbol: "1443260157",
      issue_date: "2026-09-15",
      due_date: "2026-09-23",
      counterparty_name: "TIMBER & PULP a.s.",
      counterparty_ico: "46692011",
      counterparty_dic: "CZ46692011",
      counterparty_email: "katerina.novakova@timber-pulp.cz",
      amount_without_vat: 101735.7,
      vat_rate: 21,
      amount: 123100.2,
      currency: "CZK",
    });
    expect(reading.warnings).toEqual([]);
  });

  it("zálohová faktura (typ 4) je proforma, dobropis (typ 2) credit_note", () => {
    expect(isdocToExactReading(parseIsdoc(isdoc({ documentType: "4" }))!, organization, "x.isdoc").document_kind).toBe("proforma");
    expect(isdocToExactReading(parseIsdoc(isdoc({ documentType: "2" }))!, organization, "x.isdoc").document_kind).toBe("credit_note");
  });

  it("u cizí měny vezme částky v cizí měně, ne přepočet do CZK", () => {
    const reading = isdocToExactReading(parseIsdoc(isdoc({ foreign: true }))!, organization, "x.isdoc");
    expect(reading.values).toMatchObject({ currency: "EUR", amount: 4924.01, amount_without_vat: 4069.43 });
  });

  it("když je naše firma v ISDOC odběratelem, identitu protistrany nevyplní a řekne proč", () => {
    const reading = isdocToExactReading(parseIsdoc(isdoc({ customerIco: "16180330" }))!, organization, "x.isdoc");
    expect(reading.values.counterparty_ico).toBeUndefined();
    expect(reading.values.counterparty_name).toBeUndefined();
    expect((reading.warnings ?? []).join(" ")).toContain("odběratel");
  });

  it("u více sazeb DPH sazbu nepředvyplní (formulář drží jednu sazbu)", () => {
    const reading = isdocToExactReading(parseIsdoc(isdoc({ secondRate: true }))!, organization, "x.isdoc");
    expect(reading.values.vat_rate).toBeUndefined();
    expect((reading.warnings ?? []).join(" ")).toContain("sazeb DPH");
  });

  it("odmítne poškozené XML a XML, které není ISDOC", () => {
    expect(parseIsdoc("<Invoice><ID>1</Invoice>")).toBeNull();
    expect(parseIsdoc('<?xml version="1.0"?><Order xmlns="urn:x"><ID>1</ID></Order>')).toBeNull();
    expect(parseIsdoc("")).toBeNull();
  });

  it("nerozbalí externí entity (DOCTYPE je odmítnut)", () => {
    expect(parseIsdoc(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Invoice xmlns="http://isdoc.cz/namespace/2013"><ID>&e;</ID></Invoice>`)).toBeNull();
  });
});
