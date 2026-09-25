import { CompanyLogo } from "@/components/company-logo";
import type { ReportPageData } from "@/lib/report-page-data";
import type { InvoiceStatus } from "@/types/invoice";

const TOP_DEBTORS_LIMIT = 10;
const TOP_CUSTOMERS_LIMIT = 5;
const TOP_IMPORTS_LIMIT = 10;

const statusNames: Record<InvoiceStatus, string> = {
  paid: "Zaplaceno",
  overdue: "Po splatnosti",
  pending: "Čeká",
  cancelled: "Storno",
};
const statusOrder: InvoiceStatus[] = ["paid", "overdue", "pending", "cancelled"];

function money(value: number, currency: string) {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return `${new Intl.DateTimeFormat("cs-CZ", { month: "short" }).format(new Date(year, (month || 1) - 1, 1))} ${String(year).slice(2)}`;
}

function monthNumberLabel(month: string) {
  return new Intl.DateTimeFormat("cs-CZ", { month: "short" }).format(new Date(2024, Number(month) - 1, 1));
}

function PageHeader({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return <header className="print-report-section-header"><span>{number}</span><div><h2>{title}</h2><p>{subtitle}</p></div></header>;
}

function PageFooter({ companyName, period, page, pages }: { companyName: string; period: string; page: number; pages: number }) {
  return <footer className="print-report-page-footer"><span>{companyName} · {period}</span><strong>Strana {page} / {pages}</strong></footer>;
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "primary" | "warning" }) {
  return <article className={tone ? `print-report-metric ${tone}` : "print-report-metric"}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

type PrintReportDocumentProps = {
  report: ReportPageData;
  currency: string;
  companyName: string;
  period: string;
  dateBasis: string;
  selectedStatus: string;
  selectedCustomer: string;
  generatedAt: string;
};

export function ReportPrintDocument({ report, currency, companyName, period, dateBasis, selectedStatus, selectedCustomer, generatedAt }: PrintReportDocumentProps) {
  const totals = report.payment_reconciliation.totals;
  const reviewedPayments = totals.auto_matched + totals.needs_review;
  const hasPaymentActivity = totals.imports > 0 || totals.accepted > 0 || reviewedPayments > 0 || totals.unmatched_payments > 0 || totals.unacknowledged_mismatch_imports > 0 || report.payment_reconciliation.recent_imports.length > 0;
  const pageCount = hasPaymentActivity ? 4 : 3;
  const netTotal = report.vat_breakdown.reduce((sum, row) => sum + Number(row.base), 0);
  const taxTotal = report.vat_breakdown.reduce((sum, row) => sum + Number(row.tax), 0);
  const topDebtors = report.debtors.slice(0, TOP_DEBTORS_LIMIT);
  const topCustomers = report.customer_concentration.slice(0, TOP_CUSTOMERS_LIMIT);
  const topImports = report.payment_reconciliation.recent_imports.slice(0, TOP_IMPORTS_LIMIT);
  const totalAging = report.aging.reduce((sum, row) => sum + Number(row.amount), 0) || 1;
  const maxMonthly = Math.max(1, ...report.monthly.flatMap((row) => [Number(row.issued), Number(row.paid)]));
  const maxYoy = Math.max(1, ...report.yoy_monthly.flatMap((row) => [Number(row.current_year), Number(row.prior_year)]));
  const concentrationTotal = report.customer_concentration.reduce((sum, row) => sum + Number(row.revenue), 0) || 1;
  const maxCustomer = Math.max(1, ...topCustomers.map((row) => Number(row.revenue)));
  const averageInvoice = report.invoice_count ? Number(report.total) / report.invoice_count : 0;
  const controls = [
    { label: "Ruční kontrola plateb", value: totals.needs_review, tone: totals.needs_review ? "warning" : "ok" },
    { label: "Nespárované platby", value: totals.unmatched_payments, tone: totals.unmatched_payments ? "danger" : "ok" },
    { label: "Nesoulad bankovního účtu", value: totals.unacknowledged_mismatch_imports, tone: totals.unacknowledged_mismatch_imports ? "danger" : "ok" },
  ] as const;
  const controlsAreClear = controls.every((item) => item.value === 0);

  return <section className="report-print-document" aria-label="Účetní report pro tisk">
    <article className="print-report-page print-report-summary-page">
      <header className="print-report-cover">
        <CompanyLogo className="print-report-logo" />
        <div className="print-report-cover-title"><span>ÚČETNÍ REPORT</span><h1>{companyName}</h1><p>{period}</p></div>
        <dl className="print-report-meta">
          <div><dt>Období podle</dt><dd>{dateBasis}</dd></div>
          <div><dt>Měna</dt><dd>{currency}</dd></div>
          <div><dt>Stav</dt><dd>{selectedStatus}</dd></div>
          <div><dt>Odběratel</dt><dd>{selectedCustomer}</dd></div>
          <div><dt>Vytvořeno</dt><dd>{generatedAt}</dd></div>
        </dl>
      </header>

      <section className="print-report-metrics six" aria-label="Hlavní účetní hodnoty">
        <Metric label="Fakturováno" value={money(Number(report.total), currency)} note={`${report.invoice_count} faktur`} tone="primary" />
        <Metric label="Základ bez DPH" value={money(netTotal, currency)} note="ve vybraném období" />
        <Metric label="DPH" value={money(taxTotal, currency)} note="daň ve výběru" />
        <Metric label="Přijaté úhrady" value={money(Number(report.paid), currency)} note={`${report.paid_rate} % uhrazeno`} />
        <Metric label="Otevřeno" value={money(Number(report.open), currency)} note="čeká na úhradu" />
        <Metric label="Po splatnosti" value={money(Number(report.overdue), currency)} note="vyžaduje pozornost" tone={Number(report.overdue) > 0 ? "warning" : undefined} />
      </section>

      <section className="print-report-block">
        <div className="print-report-block-heading"><div><h2>Rozpis DPH</h2><p>Podklad pro kontrolu daňového přiznání</p></div><strong>{money(taxTotal, currency)}</strong></div>
        {report.vat_breakdown.length ? <table className="print-report-table print-vat-table"><thead><tr><th>Sazba</th><th>Základ daně</th><th>DPH</th><th>Celkem</th><th>Faktur</th></tr></thead><tbody>{report.vat_breakdown.map((row) => <tr key={row.vat_rate}><td><strong>{row.vat_rate} %</strong></td><td>{money(Number(row.base), currency)}</td><td>{money(Number(row.tax), currency)}</td><td>{money(Number(row.gross), currency)}</td><td>{row.count}</td></tr>)}</tbody><tfoot><tr><td>Celkem</td><td>{money(netTotal, currency)}</td><td>{money(taxTotal, currency)}</td><td>{money(Number(report.total), currency)}</td><td>{report.vat_breakdown.reduce((sum, row) => sum + row.count, 0)}</td></tr></tfoot></table> : <p className="print-report-empty">Ve vybraném období nejsou data pro rozpis DPH.</p>}
      </section>

      <div className="print-report-summary-bottom">
        <section className="print-report-block compact"><div className="print-report-block-heading"><div><h2>Stav faktur</h2><p>Počet dokladů podle stavu</p></div></div><div className="print-status-bar">{statusOrder.map((key) => <i className={key} key={key} style={{ width: `${report.invoice_count ? report.counts[key] / report.invoice_count * 100 : 0}%` }}/>)}</div><div className="print-status-legend">{statusOrder.map((key) => <span key={key}><i className={key}/>{statusNames[key]} <strong>{report.counts[key]}</strong></span>)}</div></section>
        <section className="print-report-block compact"><div className="print-report-block-heading"><div><h2>Kontrolní stav</h2><p>Výjimky vyžadující účetní kontrolu</p></div></div>{controlsAreClear ? <div className="print-control-clear"><strong>Bez otevřených kontrol</strong><span>Platby a bankovní importy nevykazují nevyřešené výjimky.</span></div> : <div className="print-control-list">{controls.map((item) => <div className={item.tone} key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>}</section>
      </div>
      <PageFooter companyName={companyName} period={period} page={1} pages={pageCount} />
    </article>

    <article className="print-report-page">
      <PageHeader number="02" title="Pohledávky a rizika" subtitle="Otevřené částky, stáří dluhu a platební disciplína odběratelů" />
      <section className="print-report-metrics four" aria-label="Souhrn pohledávek">
        <Metric label="Otevřeno" value={money(Number(report.open), currency)} note="celkem" />
        <Metric label="Po splatnosti" value={money(Number(report.overdue), currency)} note="riziková část" tone={Number(report.overdue) > 0 ? "warning" : undefined} />
        <Metric label="Míra úhrad" value={`${report.paid_rate} %`} note="z nestornovaných faktur" />
        <Metric label="Průměrná doba úhrady" value={`${report.dso.avg_days} dní`} note={`${report.dso.paid_invoice_count} plně uhrazených`} />
      </section>
      <section className="print-report-block print-aging-block"><div className="print-report-block-heading"><div><h2>Stáří pohledávek</h2><p>Rozložení částek podle dní po splatnosti</p></div></div><div className="print-aging-bar">{report.aging.map((bucket, index) => <i className={`risk-${index}`} key={bucket.label} style={{ width: `${Number(bucket.amount) / totalAging * 100}%` }}/>)}</div><div className="print-aging-list">{report.aging.map((bucket, index) => <div key={bucket.label}><i className={`risk-${index}`}/><span>{bucket.label}<small>{bucket.count} {bucket.count === 1 ? "faktura" : "faktur"}</small></span><strong>{money(Number(bucket.amount), currency)}</strong></div>)}</div></section>
      <section className="print-report-block print-debtors-block"><div className="print-report-block-heading"><div><h2>Nejvýznamnější dlužníci</h2><p>Zobrazeno {topDebtors.length} z {report.debtors.length} odběratelů · úplný seznam je dostupný v aplikaci a Excelu</p></div></div>{topDebtors.length ? <table className="print-report-table print-debtors-table"><thead><tr><th>#</th><th>Odběratel</th><th>Otevřeno</th><th>Po splatnosti</th><th>Faktur</th><th>Upomínky</th></tr></thead><tbody>{topDebtors.map((row, index) => <tr key={row.name}><td>{index + 1}</td><td><strong>{row.name}</strong></td><td>{money(Number(row.open), currency)}</td><td className={Number(row.overdue) > 0 ? "is-risk" : undefined}>{money(Number(row.overdue), currency)}</td><td>{row.count}</td><td>{row.reminders}</td></tr>)}</tbody></table> : <p className="print-report-empty">Ve vybraném období nejsou žádné otevřené pohledávky.</p>}</section>
      <PageFooter companyName={companyName} period={period} page={2} pages={pageCount} />
    </article>

    <article className="print-report-page">
      <PageHeader number="03" title="Tržby a odběratelé" subtitle="Vývoj fakturace, úhrad a koncentrace odběratelů" />
      <div className="print-revenue-grid">
        <section className="print-report-block print-revenue-main"><div className="print-report-block-heading"><div><h2>Fakturace a úhrady</h2><p>Měsíční srovnání vystavených a přijatých částek</p></div></div>{report.monthly.length === 1 ? <div className="print-single-month"><span>{monthLabel(report.monthly[0].key)}</span><div><article><small>Vystaveno</small><strong>{money(Number(report.monthly[0].issued), currency)}</strong></article><article><small>Uhrazeno</small><strong>{money(Number(report.monthly[0].paid), currency)}</strong></article></div></div> : report.monthly.length ? <div className="print-column-chart">{report.monthly.map((row) => <div key={row.key}><div><i className="issued" style={{ height: `${Number(row.issued) / maxMonthly * 100}%` }}/><i className="paid" style={{ height: `${Number(row.paid) / maxMonthly * 100}%` }}/></div><span>{monthLabel(row.key)}</span></div>)}</div> : <p className="print-report-empty">Ve vybraném období nejsou žádné faktury.</p>}</section>
        <section className="print-report-block print-customer-ranking"><div className="print-report-block-heading"><div><h2>Top 5 odběratelů</h2><p>Podíl na fakturovaných tržbách</p></div></div>{topCustomers.length ? <div className="print-ranking-list">{topCustomers.map((row, index) => <div key={row.name}><div><span>{index + 1}. {row.name}</span><strong>{Math.round(Number(row.revenue) / concentrationTotal * 100)} %</strong></div><i><b style={{ width: `${Number(row.revenue) / maxCustomer * 100}%` }}/></i><small>{money(Number(row.revenue), currency)}</small></div>)}</div> : <p className="print-report-empty">Nejsou dostupné tržby podle odběratelů.</p>}</section>
        <section className="print-report-block print-yoy-block"><div className="print-report-block-heading"><div><h2>Meziroční srovnání</h2><p>Aktuální období proti předchozímu roku</p></div></div>{report.yoy_monthly.length === 1 ? <div className="print-single-month compact"><span>{monthNumberLabel(report.yoy_monthly[0].month)}</span><div><article><small>Předchozí rok</small><strong>{money(Number(report.yoy_monthly[0].prior_year), currency)}</strong></article><article><small>Aktuální rok</small><strong>{money(Number(report.yoy_monthly[0].current_year), currency)}</strong></article></div></div> : report.yoy_monthly.length ? <div className="print-column-chart compact">{report.yoy_monthly.map((row) => <div key={row.month}><div><i className="prior" style={{ height: `${Number(row.prior_year) / maxYoy * 100}%` }}/><i className="current" style={{ height: `${Number(row.current_year) / maxYoy * 100}%` }}/></div><span>{monthNumberLabel(row.month)}</span></div>)}</div> : <p className="print-report-empty">Pro meziroční srovnání nejsou dostupná data.</p>}</section>
        <section className="print-average-invoice"><span>Průměrná faktura</span><strong>{money(averageInvoice, currency)}</strong><small>{report.invoice_count} faktur ve výběru</small></section>
      </div>
      <PageFooter companyName={companyName} period={period} page={3} pages={pageCount} />
    </article>

    {hasPaymentActivity && <article className="print-report-page">
      <PageHeader number="04" title="Párování bankovních plateb" subtitle="Výsledek automatického zpracování a otevřené kontroly" />
      <section className="print-report-metrics four" aria-label="Souhrn párování plateb">
        <Metric label="Přijaté platby" value={String(totals.accepted)} note="potvrzeno v období" />
        <Metric label="Automaticky spárováno" value={String(totals.auto_matched)} note={`${reviewedPayments ? Math.round(totals.auto_matched / reviewedPayments * 100) : 0} % posouzených`} tone="primary" />
        <Metric label="Ruční kontrola" value={String(totals.needs_review)} note="vyžadovalo rozhodnutí" tone={totals.needs_review ? "warning" : undefined} />
        <Metric label="Nespárované" value={String(totals.unmatched_payments)} note="zbývá vyřešit" tone={totals.unmatched_payments ? "warning" : undefined} />
      </section>
      <section className="print-report-block print-matching-block"><div className="print-report-block-heading"><div><h2>Úspěšnost párování</h2><p>Poměr automatického zpracování a ruční kontroly</p></div><strong>{reviewedPayments ? Math.round(totals.auto_matched / reviewedPayments * 100) : 0} % automaticky</strong></div><div className="print-matching-bar"><i className="auto" style={{ width: `${reviewedPayments ? totals.auto_matched / reviewedPayments * 100 : 0}%` }}/><i className="review" style={{ width: `${reviewedPayments ? totals.needs_review / reviewedPayments * 100 : 0}%` }}/></div><div className="print-matching-legend"><span><i className="auto"/>Automaticky <strong>{totals.auto_matched}</strong></span><span><i className="review"/>Ruční kontrola <strong>{totals.needs_review}</strong></span>{totals.unacknowledged_mismatch_imports > 0 && <span className="danger"><i/>Nesoulad účtu <strong>{totals.unacknowledged_mismatch_imports}</strong></span>}</div></section>
      <section className="print-report-block print-imports-block"><div className="print-report-block-heading"><div><h2>Poslední potvrzené výpisy</h2><p>Zobrazeno {topImports.length} z {report.payment_reconciliation.recent_imports.length} importů · úplný přehled je dostupný v aplikaci</p></div></div>{topImports.length ? <table className="print-report-table print-imports-table"><thead><tr><th>Soubor</th><th>Datum</th><th>Přijato</th><th>Automaticky</th><th>Kontrola</th><th>Chyby</th></tr></thead><tbody>{topImports.map((item) => <tr key={item.id}><td><strong>{item.filename}</strong></td><td>{new Intl.DateTimeFormat("cs-CZ").format(new Date(item.committed_at))}</td><td>{item.accepted_count}</td><td>{item.auto_matched}</td><td className={item.needs_review ? "is-warning" : undefined}>{item.needs_review}</td><td className={item.error_count ? "is-risk" : undefined}>{item.error_count}</td></tr>)}</tbody></table> : <p className="print-report-empty">V období nejsou žádné potvrzené bankovní výpisy.</p>}</section>
      <PageFooter companyName={companyName} period={period} page={4} pages={pageCount} />
    </article>}
  </section>;
}
