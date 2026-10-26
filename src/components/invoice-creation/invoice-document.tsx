"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { CompanyLogo } from "@/components/company-logo";
import {
  publicInvoiceDocument,
  creationUnitPrice,
  type IssuedInvoiceDocument,
} from "@/lib/invoice-creation";
import { exactMoney } from "@/lib/money-display";
import { formatCzechDate } from "@/lib/display-date";
import { buildSpayd } from "@/lib/czech-payment";
import styles from "./invoice-creation.module.css";

export function InvoiceDocument({
  document,
}: {
  document: IssuedInvoiceDocument;
}) {
  const model = publicInvoiceDocument(document),
    [qr, setQr] = useState<string | null>(null);
  const spayd =
    model.payment_method === "bank" && model.currency === "CZK"
      ? buildSpayd({
          account: model.payment_account,
          amount: model.totals.gross,
          currency: model.currency,
          variableSymbol: model.variable_symbol,
          dueDate: model.due_date,
          message: model.invoice_number,
        })
      : null;
  useEffect(() => {
    let active = true;
    setQr(null);
    if (!spayd) return;
    const timer = setTimeout(() => {
      void QRCode.toDataURL(spayd, { margin: 4, width: 288 })
        .then((url) => {
          if (active) setQr(url);
        })
        .catch(() => {});
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [spayd]);
  return (
    <article
      className={styles.paper}
      aria-label="Živý náhled faktury"
      data-invoice-document
      tabIndex={0}
    >
      <header className={styles.documentHeading}>
        <div>
          <span className={styles.documentKicker}>
            {model.supplier.vat_payer
              ? "Daňový doklad"
              : "Faktura neplátce DPH"}
          </span>
          <h3>{model.supplier.name || "Vaše firma"}</h3>
          <p className={styles.documentNumber}>
            Faktura č. {model.invoice_number || "—"}
          </p>
        </div>
        <div className={styles.documentBrand}>
          <CompanyLogo
            src={model.supplier.logo_path}
            name={model.supplier.name}
            fallbackSrc="/brand/splatno-auth-mark.png"
            className={styles.documentLogo}
          />
        </div>
      </header>
      <dl className={styles.documentDates}>
        <div>
          <dt>Vystaveno</dt>
          <dd>{formatCzechDate(model.issue_date)}</dd>
        </div>
        {model.supplier.vat_payer && (
          <div>
            <dt>DUZP</dt>
            <dd>{formatCzechDate(model.tax_date)}</dd>
          </div>
        )}
        <div>
          <dt>Splatnost</dt>
          <dd>{formatCzechDate(model.due_date)}</dd>
        </div>
      </dl>
      <div className={styles.parties}>
        {(
          [
            ["Dodavatel", model.supplier],
            ["Odběratel", model.customer],
          ] as const
        ).map(([label, party]) => (
          <section key={label}>
            <span>{label}</span>
            <strong>{party.name || "Doplňte odběratele"}</strong>
            <p>{party.address || "Fakturační adresa"}</p>
            <div className={styles.partyIdentifiers}>
              {party.ico && <p>IČO {party.ico}</p>}
              {party.dic && <p>DIČ {party.dic}</p>}
            </div>
            {party.email && <p className={styles.partyEmail}>{party.email}</p>}
          </section>
        ))}
      </div>
      <div className={styles.documentTable}>
        <table>
          <thead>
            <tr>
              <th scope="col">Položka</th>
              <th scope="col">Množství</th>
              <th scope="col">
                {model.supplier.vat_payer ? "Cena/MJ bez DPH" : "Cena/MJ"}
              </th>
              <th scope="col">
                {model.supplier.vat_payer ? "Celkem s DPH" : "Celkem"}
              </th>
            </tr>
          </thead>
          <tbody>
            {model.totals.lines.map((line, i) => (
              <tr key={line.id + i}>
                <td className={styles.lineDescription}>
                  <strong>{line.description || "Název položky"}</strong>
                  <div className={styles.lineDetails}>
                    {model.supplier.vat_payer && (
                      <span>DPH {line.vat_rate} %</span>
                    )}
                    {Number(line.discount.replace(",", ".")) > 0 && (
                      <span>Sleva {line.discount} %</span>
                    )}
                  </div>
                </td>
                <td data-label="Množství">
                  {line.quantity} {line.unit}
                </td>
                <td
                  data-label={
                    model.supplier.vat_payer ? "Cena/MJ bez DPH" : "Cena/MJ"
                  }
                >
                  {creationUnitPrice(line.unit_price, model.currency)}
                </td>
                <td
                  data-label={
                    model.supplier.vat_payer ? "Celkem s DPH" : "Celkem"
                  }
                >
                  <strong>{exactMoney(line.gross, model.currency)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className={styles.documentTotals}>
        {model.supplier.vat_payer && (
          <>
            <div>
              <dt>Celkem bez DPH</dt>
              <dd>{exactMoney(model.totals.net, model.currency)}</dd>
            </div>
            {model.totals.breakdown.map((row) => (
              <div key={row.rate}>
                <dt>DPH {row.rate} %</dt>
                <dd>{exactMoney(row.tax, model.currency)}</dd>
              </div>
            ))}
          </>
        )}
        <div className={styles.totalDue}>
          <dt>Celkem k úhradě</dt>
          <dd>{exactMoney(model.totals.gross, model.currency)}</dd>
        </div>
      </dl>
      <div className={styles.paymentInstructions}>
        <div>
          <span className={styles.documentKicker}>Platební údaje</span>
          <strong>
            {model.payment_method === "bank" ? "Bankovní převod" : "Hotově"}
          </strong>
          <dl>
            {model.payment_account && (
              <div>
                <dt>Číslo účtu</dt>
                <dd>{model.payment_account}</dd>
              </div>
            )}
            {model.variable_symbol && (
              <div>
                <dt>Variabilní symbol</dt>
                <dd>{model.variable_symbol}</dd>
              </div>
            )}
          </dl>
        </div>
        {qr && (
          <figure>
            <Image
              src={qr}
              alt="QR platba"
              width={72}
              height={72}
              unoptimized
            />
            <figcaption>QR platba</figcaption>
          </figure>
        )}
      </div>
      {!model.supplier.vat_payer && (
        <p className={styles.nonpayerNote}>Dodavatel není plátcem DPH.</p>
      )}
      {model.public_note && (
        <p className={styles.documentNote}>{model.public_note}</p>
      )}
    </article>
  );
}
