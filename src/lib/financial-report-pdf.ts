import "server-only";
import { ReportDrawing } from "./financial-report-drawing";
import {
  createReportMoney,
  REPORT_BASES,
  REPORT_METHODS,
  REPORT_MODES,
  REPORT_SECTIONS,
  REPORT_STATUS,
  type FinancialReportModel,
  type ReportSection,
} from "./financial-report";
import { vatMetrics } from "./report-presentation";
import { formatCzechDate } from "./display-date";
const num = (v: number) =>
  new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(
    Number(v),
  );
const month = (value: string) => {
  const [y, m] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("cs-CZ", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
};
const stamp = (value: string) =>
  new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
export async function generateFinancialReport(model: FinancialReportModel) {
  const d = await ReportDrawing.create(model),
    s = model.snapshot,
    r = s.report,
    p = s.payments,
    o = model.options,
    q = model.query;
  const money = createReportMoney(q.currency),
    vat = vatMetrics(r),
    has = (section: ReportSection) => o.sections.includes(section);
  const groups = s.invoices.flatMap((i) =>
    (
      i.vat_groups ?? [
        {
          rate: i.vat_rate,
          net: Number(i.amount_without_vat),
          tax: Number(i.amount) - Number(i.amount_without_vat),
          gross: Number(i.amount),
        },
      ]
    ).map((g) => ({ invoice: i, ...g })),
  );
  const scope = `${formatCzechDate(q.from)} – ${formatCzechDate(q.to)} · ${q.currency}`;
  const filterRows = [
    ["Období", scope],
    ["Fakturové datum", REPORT_BASES[q.dateBasis]],
    ["Stav faktury", q.status ? REPORT_STATUS[q.status] : "Všechny stavy"],
    ["Odběratel", q.customer ?? "Všichni odběratelé"],
    ["Sestaveno", `${stamp(s.generated_at)} · Europe/Prague`],
    ["Stav pohledávek ke dni", formatCzechDate(s.as_of)],
  ];
  const revenueKPIs = () =>
    d.kpis([
      {
        label: "Fakturováno",
        value: money(s.exact_totals?.total ?? r.total),
        note: `${num(r.invoice_count)} vybraných faktur`,
      },
      {
        label: "Evidované úhrady",
        value: money(s.exact_totals?.paid ?? r.paid),
        note: "Současné úhrady nestornovaných faktur",
      },
      {
        label: "Počet faktur",
        value: num(r.invoice_count),
        note: "Včetně vybraných storen",
      },
      {
        label: "Průměrná doba úhrady",
        value: r.dso.paid_invoice_count ? `${num(r.dso.avg_days)} dní` : "—",
        note: `${num(r.dso.paid_invoice_count)} plně uhrazených faktur`,
      },
    ]);
  const vatKPIs = () =>
    d.kpis([
      {
        label: "Evidovaný základ",
        value: money(s.exact_totals?.base ?? vat.base),
        note: "Ve zvoleném výběru",
      },
      {
        label: "Evidovaná daň",
        value: money(s.exact_totals?.tax ?? vat.tax),
        note: "Bez odpočtů vstupní DPH",
      },
      { label: "Sazby / kategorie", value: num(r.vat_breakdown.length) },
      {
        label: "Počet faktur",
        value: num(r.invoice_count),
        note: "Faktura může mít více sazeb",
      },
    ]);
  const receivableKPIs = () =>
    d.kpis([
      {
        label: "Otevřené pohledávky",
        value: money(s.exact_totals?.open ?? r.open),
        note: "Současné zbývající částky",
      },
      {
        label: "Po splatnosti",
        value: money(s.exact_totals?.overdue ?? r.overdue),
        note: "Podle evidovaného stavu",
      },
      {
        label: "Otevřené faktury",
        value: num(r.counts.pending + r.counts.overdue),
      },
      {
        label: "Průměrná doba úhrady",
        value: r.dso.paid_invoice_count ? `${num(r.dso.avg_days)} dní` : "—",
        note: "Jen plně uhrazené faktury",
      },
    ]);
  const paymentKPIs = () =>
    d.kpis([
      {
        label: "Přijaté řádky výpisů",
        value: num(p.totals.accepted),
        note: "Počet, nikoli finanční částka",
      },
      { label: "Posouzené jako bezpečné", value: num(p.totals.auto_matched) },
      {
        label: "Zpracované výpisy",
        value: num(p.totals.imports),
        note: "Zaúčtováno ve zvoleném období",
      },
      { label: "Ručně posuzované řádky", value: num(p.totals.needs_review) },
    ]);
  const revenueChart = () =>
    d.bars(
      "Tržby podle měsíců",
      r.monthly.map((m) => ({
        label: month(m.key),
        values: [Number(m.issued), Number(m.paid)],
      })),
      ["Fakturováno", "Evidované úhrady"],
      q.currency,
    );
  const aging = () =>
    d.horizontal(
      (s.exact_aging ?? r.aging).map((b) => ({
        label: b.label,
        amount: money(b.amount),
        value: Number(b.amount),
        note: `${num(b.count)} faktur`,
      })),
    );
  const customerTable = () =>
    d.table(
      [
        { label: "Odběratel", weight: 3 },
        { label: "Fakturováno", weight: 2, right: true },
        { label: "Evidované úhrady", weight: 2, right: true },
        { label: "Podíl", weight: 1, right: true },
        { label: "Faktur", weight: 0.7, right: true },
      ],
      s.customers.map((c) => [
        c.name,
        money(c.invoiced),
        money(c.paid),
        Number(r.total) > 0
          ? `${num((Number(c.invoiced) / Number(r.total)) * 100)} %`
          : "—",
        num(c.count),
      ]),
    );
  const invoiceTable = () =>
    d.table(
      [
        { label: "Vystavení", weight: 1.2 },
        { label: "Faktura", weight: 1.5 },
        { label: "Odběratel", weight: 2.4 },
        { label: "Částka", weight: 1.8, right: true },
        { label: "Splatnost", weight: 1.2 },
        { label: "Stav", weight: 1.5 },
      ],
      s.invoices.map((i) => [
        formatCzechDate(i.issue_date),
        i.invoice_number,
        i.counterparty_name,
        money(i.amount),
        formatCzechDate(i.due_date),
        REPORT_STATUS[i.status],
      ]),
    );
  const vatTable = () =>
    d.table(
      [
        { label: "Sazba / kategorie", weight: 1.3 },
        { label: "Základ", weight: 2, right: true },
        { label: "DPH", weight: 1.8, right: true },
        { label: "Celkem", weight: 2, right: true },
        { label: "Faktur v sazbě", weight: 1, right: true },
      ],
      [
        ...(s.exact_vat ?? r.vat_breakdown).map((g) => [
          Number(g.vat_rate) === 0 ? "0 % / ostatní" : `${num(g.vat_rate)} %`,
          money(g.base),
          money(g.tax),
          money(g.gross),
          num(g.count),
        ]),
        [
          "Celkem",
          money(s.exact_totals?.base ?? vat.base),
          money(s.exact_totals?.tax ?? vat.tax),
          money(s.exact_totals?.total ?? r.total),
          num(r.invoice_count),
        ],
      ],
      { total: true },
    );
  const vatDonut = () =>
    d.donut(
      "Podíl podle evidovaných kategorií",
      (s.exact_vat ?? r.vat_breakdown).map((g) => ({
        label:
          Number(g.vat_rate) === 0 ? "0 % / ostatní" : `${num(g.vat_rate)} %`,
        value: Number(g.gross),
        detail: money(g.gross),
      })),
      `${num(r.vat_breakdown.length)} ${r.vat_breakdown.length === 1 ? "sazba" : r.vat_breakdown.length >= 2 && r.vat_breakdown.length <= 4 ? "sazby" : "sazeb"}`,
    );
  const debtors = () =>
    d.table(
      [
        { label: "Odběratel", weight: 3 },
        { label: "Otevřeno", weight: 2, right: true },
        { label: "Po splatnosti", weight: 2, right: true },
        { label: "Faktur", weight: 1, right: true },
      ],
      (s.exact_debtors ?? r.debtors).map((c) => [
        c.name,
        money(c.open),
        money(c.overdue),
        num(c.count),
      ]),
    );
  const paymentChart = () =>
    d.bars(
      "Vývoj zpracování výpisů",
      p.monthly.map((m) => ({
        label: month(m.key),
        values: [m.auto_matched, m.needs_review],
      })),
      ["Bezpečný návrh", "Ruční posouzení"],
    );
  const paymentDonut = () =>
    d.donut(
      "Způsob posouzení",
      [
        {
          label: "Bezpečný návrh",
          value: p.totals.auto_matched,
          detail: `${num(p.totals.auto_matched)} řádků`,
        },
        {
          label: "Ruční posouzení",
          value: p.totals.needs_review,
          detail: `${num(p.totals.needs_review)} řádků`,
        },
      ],
      num(p.totals.auto_matched + p.totals.needs_review),
    );
  const importTable = () =>
    d.table(
      [
        { label: "Výpis", weight: 3 },
        { label: "Zaúčtováno", weight: 1.6 },
        { label: "Přijato", weight: 1, right: true },
        { label: "Bezpečný návrh", weight: 1.3, right: true },
        { label: "Ruční posouzení", weight: 1.3, right: true },
        { label: "Chyby", weight: 0.8, right: true },
      ],
      s.imports.map((i) => [
        i.filename,
        stamp(i.committed_at),
        num(i.accepted_count),
        num(i.auto_matched),
        num(i.needs_review),
        num(i.error_count),
      ]),
    );
  const hasData =
    (o.sections.some((k) => k !== "payments") && r.invoice_count > 0) ||
    (has("payments") &&
      (p.totals.imports > 0 || p.totals.unmatched_payments > 0));
  if (!hasData) {
    d.newPage("Finanční report · bez záznamů", scope);
    d.note(
      "Ve zvoleném období a filtrech nejsou dostupné záznamy pro vybrané oblasti. Nejde o potvrzení nulových hodnot mimo tento výběr.",
    );
    d.table(
      [
        { label: "Filtr", weight: 1 },
        { label: "Hodnota", weight: 3 },
      ],
      filterRows,
    );
    for (const section of o.sections) {
      d.heading(REPORT_SECTIONS[section]);
      d.paragraph(REPORT_METHODS[section]);
    }
    return d.finish();
  }
  if (o.mode === "summary") {
    if (has("revenue")) {
      d.newPage("Přehled tržeb", scope);
      d.kpis([
        {
          label: "Fakturováno",
          value: money(s.exact_totals?.total ?? r.total),
        },
        {
          label: "Evidované úhrady",
          value: money(s.exact_totals?.paid ?? r.paid),
        },
      ]);
      if (o.charts) revenueChart();
      d.note(REPORT_METHODS.revenue);
    }
    if (has("vat")) {
      d.newPage("Přehled DPH", scope);
      d.kpis([
        {
          label: "Evidovaná daň",
          value: money(s.exact_totals?.tax ?? vat.tax),
        },
        {
          label: "Evidovaný základ",
          value: money(s.exact_totals?.base ?? vat.base),
        },
      ]);
      d.note(REPORT_METHODS.vat);
    }
    if (has("receivables")) {
      d.newPage(
        "Přehled pohledávek",
        `${scope} · současný stav ke dni ${formatCzechDate(s.as_of)}`,
      );
      d.kpis([
        {
          label: "Otevřené pohledávky",
          value: money(s.exact_totals?.open ?? r.open),
        },
        {
          label: "Po splatnosti",
          value: money(s.exact_totals?.overdue ?? r.overdue),
        },
      ]);
      d.note(REPORT_METHODS.receivables);
    }
    if (o.sections.some((section) => section !== "payments"))
      d.note(
        `Fakturové datum: ${REPORT_BASES[q.dateBasis]}. Stav: ${q.status ? REPORT_STATUS[q.status] : "všechny stavy"}. Odběratel: ${q.customer ?? "všichni"}. Úhrady a pohledávky jsou současné evidované hodnoty. KPI úhrad vynechává storna; měsíční přehled zachovává úhrady všech vybraných faktur. DPH není daňové přiznání.`,
      );
    if (has("payments")) {
      d.newPage(
        "Bankovní přehled",
        `${formatCzechDate(q.from)} – ${formatCzechDate(q.to)} · celá firma, všechny měny · počty`,
      );
      paymentKPIs();
      if (o.charts) paymentChart();
      d.note(REPORT_METHODS.payments);
    }
    return d.finish();
  }
  if (o.mode === "detailed") {
    if (has("revenue")) {
      d.newPage("Přehled tržeb");
      d.kpis([
        {
          label: "Fakturováno",
          value: money(s.exact_totals?.total ?? r.total),
          note: `${num(r.invoice_count)} vybraných faktur`,
        },
        {
          label: "Evidované úhrady",
          value: money(s.exact_totals?.paid ?? r.paid),
          note: "Současné úhrady nestornovaných faktur",
        },
      ]);
      if (o.charts) revenueChart();
      if (o.customers) {
        d.newPage("Největší odběratelé");
        d.heading("Fakturace podle odběratele");
        customerTable();
      }
      if (o.details) {
        d.newPage("Detailní přehled faktur");
        invoiceTable();
      }
    }
    if (has("vat")) {
      d.newPage("Přehled DPH");
      d.kpis([
        {
          label: "Evidovaný základ",
          value: money(s.exact_totals?.base ?? vat.base),
        },
        {
          label: "Evidovaná daň",
          value: money(s.exact_totals?.tax ?? vat.tax),
        },
      ]);
      vatTable();
      if (o.charts) vatDonut();
      d.paragraph(
        "Tento report není daňovým přiznáním. Datumový základ a rozsah popisuje metodika sestavy.",
      );
      if (o.details) {
        d.newPage("Detailní přehled DPH");
        d.table(
          [
            { label: "Faktura", weight: 2 },
            { label: "Základ", weight: 1.8, right: true },
            { label: "Sazba", weight: 1 },
            { label: "DPH", weight: 1.5, right: true },
            { label: "Celkem", weight: 1.8, right: true },
          ],
          groups.map((g) => [
            g.invoice.invoice_number,
            money(g.net),
            g.rate === null ? "Neplátce" : `${num(g.rate)} %`,
            money(g.tax),
            money(g.gross),
          ]),
        );
      }
    }
    if (has("receivables")) {
      d.newPage(
        "Přehled pohledávek",
        `${scope} · současný stav ke dni ${formatCzechDate(s.as_of)}`,
      );
      d.kpis([
        {
          label: "Otevřené pohledávky",
          value: money(s.exact_totals?.open ?? r.open),
          note: `${num(r.counts.pending + r.counts.overdue)} otevřených faktur`,
        },
        {
          label: "Po splatnosti",
          value: money(s.exact_totals?.overdue ?? r.overdue),
          note: r.dso.paid_invoice_count
            ? `Do úplné úhrady průměrně ${num(r.dso.avg_days)} dní`
            : "Bez plně uhrazených faktur pro dobu úhrady",
        },
      ]);
      d.heading("Stav pohledávek podle splatnosti");
      aging();
      if (o.customers) {
        d.newPage("Analýza pohledávek");
        d.heading("Největší otevřené pohledávky");
        debtors();
      }
    }
    if (has("payments")) {
      d.newPage(
        "Přehled plateb",
        `${formatCzechDate(q.from)} – ${formatCzechDate(q.to)} · celá firma, všechny měny · počty`,
      );
      d.kpis([
        {
          label: "Přijaté řádky",
          value: num(p.totals.accepted),
          note: `${num(p.totals.imports)} zaúčtovaných výpisů`,
        },
        {
          label: "Bezpečný návrh",
          value: num(p.totals.auto_matched),
          note: `Ruční posouzení: ${num(p.totals.needs_review)}`,
        },
      ]);
      if (o.charts) {
        paymentChart();
        d.newPage("Rozdělení posouzení");
        paymentDonut();
      }
      if (o.details) {
        d.newPage("Detail zaúčtovaných výpisů");
        importTable();
      }
    }
    d.newPage("Metodika a rozsah reportu");
    d.table(
      [
        { label: "Filtr", weight: 1 },
        { label: "Hodnota", weight: 3 },
      ],
      filterRows,
    );
    for (const section of o.sections) {
      d.heading(REPORT_SECTIONS[section]);
      d.paragraph(REPORT_METHODS[section]);
    }
    return d.finish();
  }
  if (o.mode === "complete" || o.mode === "custom") {
    d.newPage("Finanční report", REPORT_MODES[o.mode]);
    d.y += 35;
    d.y +=
      d.text("Komplexní přehled hospodaření a pohledávek", d.margin, d.y, {
        size: 25,
        strong: true,
        width: d.contentWidth * 0.85,
      }) + 28;
    d.y +=
      d.text(s.company.name, d.margin, d.y, { size: 18, strong: true }) + 12;
    d.paragraph(
      [
        s.company.ico && `IČO ${s.company.ico}`,
        s.company.dic && `DIČ ${s.company.dic}`,
        s.company.address,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    d.table(
      [
        { label: "Rozsah", weight: 1 },
        { label: "Hodnota", weight: 3 },
      ],
      filterRows,
    );
    d.note(
      `Obsah: ${o.sections.map((k) => REPORT_SECTIONS[k]).join(" · ")}. ${o.details ? "Podrobné tabulky odpovídají vybraným oblastem a nevynechávají odpovídající záznamy." : "Bez podrobných registrů faktur a výpisů."} Stav dat odpovídá okamžiku sestavení, nikoli rekonstrukci historie.`,
    );
  }
  if (has("revenue")) {
    d.newPage("Přehled tržeb");
    revenueKPIs();
    if (o.charts) revenueChart();
    d.note(REPORT_METHODS.revenue);
    if (o.customers) {
      d.newPage("Největší odběratelé");
      d.heading("Fakturace podle odběratele");
      customerTable();
      d.note(
        "Pořadí odpovídá součtu fakturovaných částek ve výběru včetně vybraných storen. Podíl se vztahuje k celkové fakturaci výběru; při nulovém či záporném celku není uváděn.",
      );
    }
    if (o.details) {
      d.newPage("Detailní přehled faktur");
      d.paragraph(
        `Úplný registr: ${num(s.invoices.length)} faktur. Období podle ${REPORT_BASES[q.dateBasis].toLocaleLowerCase("cs-CZ")}.`,
      );
      invoiceTable();
    }
  }
  if (has("vat")) {
    d.newPage("Přehled DPH");
    vatKPIs();
    d.heading("Rozpis DPH podle sazeb");
    vatTable();
    if (o.charts) vatDonut();
    d.note(
      "Tento report není daňovým přiznáním. Používá zvolený fakturový datumový základ, nikoli vlastní období DUZP.",
    );
    if (o.details) {
      d.newPage("Detailní přehled DPH");
      d.note(REPORT_METHODS.vat);
      d.table(
        [
          { label: "Vystavení", weight: 1.2 },
          { label: "Faktura", weight: 1.7 },
          { label: "Základ", weight: 1.8, right: true },
          { label: "Sazba / kategorie", weight: 1.1 },
          { label: "DPH", weight: 1.6, right: true },
          { label: "Celkem", weight: 1.8, right: true },
        ],
        groups.map((g) => [
          formatCzechDate(g.invoice.issue_date),
          g.invoice.invoice_number,
          money(g.net),
          g.rate === null
            ? "Neplátce"
            : g.rate === 0
              ? "0 % / ostatní"
              : `${num(g.rate)} %`,
          money(g.tax),
          money(g.gross),
        ]),
      );
    }
  }
  if (has("receivables")) {
    d.newPage(
      "Přehled pohledávek",
      `${scope} · současný stav ke dni ${formatCzechDate(s.as_of)}`,
    );
    receivableKPIs();
    d.heading("Stav pohledávek podle splatnosti");
    aging();
    d.note(
      "Zobrazeny jsou zbývající částky po částečných úhradách. Historické zůstatky se nerekonstruují.",
    );
    d.newPage("Analýza pohledávek");
    if (o.customers) {
      d.heading("Největší otevřené pohledávky");
      debtors();
    }
    d.heading("Platební disciplína");
    d.kpis([
      {
        label: "Průměr do úplné úhrady",
        value: r.dso.paid_invoice_count ? `${num(r.dso.avg_days)} dní` : "—",
      },
      { label: "Plně uhrazené faktury", value: num(r.dso.paid_invoice_count) },
    ]);
    if (o.charts)
      d.bars(
        "Průměrná doba do úplné úhrady",
        r.dso_monthly.map((m) => ({
          label: month(m.key),
          values: [Number(m.avg_days)],
        })),
        ["Dny od vystavení do úhrady"],
      );
    d.note(REPORT_METHODS.receivables);
  }
  if (has("payments")) {
    d.newPage(
      "Přehled plateb",
      `${formatCzechDate(q.from)} – ${formatCzechDate(q.to)} · celá firma, všechny měny · počty`,
    );
    paymentKPIs();
    if (o.charts) paymentChart();
    d.note(
      "Přehled obsahuje počty řádků, nikoli peněžní částky. Fakturové filtry se na bankovní část nevztahují.",
    );
    d.newPage("Rozdělení posouzení");
    if (o.charts) paymentDonut();
    d.kpis([
      { label: "Nespárované platby", value: num(p.totals.unmatched_payments) },
      {
        label: "Neodsouhlasený nesoulad účtu",
        value: num(p.totals.unacknowledged_mismatch_imports),
      },
    ]);
    if (o.details) {
      d.newPage("Detail zaúčtovaných výpisů");
      d.paragraph(
        `Úplný přehled ${num(s.imports.length)} výpisů. Detail jednotlivých bankovních řádků není součástí této sestavy.`,
      );
      importTable();
    }
    d.note(REPORT_METHODS.payments);
  }
  d.newPage("Metodika a rozsah reportu");
  d.table(
    [
      { label: "Filtr", weight: 1 },
      { label: "Hodnota", weight: 3 },
    ],
    filterRows,
  );
  for (const section of o.sections) {
    d.heading(REPORT_SECTIONS[section]);
    d.paragraph(REPORT_METHODS[section]);
  }
  if (o.mode === "complete" || o.mode === "custom") {
    d.newPage("Souhrn reportu");
    const closing = [];
    if (has("revenue"))
      closing.push(
        {
          label: "Fakturováno",
          value: money(s.exact_totals?.total ?? r.total),
        },
        {
          label: "Evidované úhrady",
          value: money(s.exact_totals?.paid ?? r.paid),
        },
      );
    if (has("receivables"))
      closing.push(
        {
          label: "Otevřené pohledávky",
          value: money(s.exact_totals?.open ?? r.open),
        },
        {
          label: "Po splatnosti",
          value: money(s.exact_totals?.overdue ?? r.overdue),
        },
      );
    if (has("vat"))
      closing.push({
        label: "Evidovaná daň",
        value: money(s.exact_totals?.tax ?? vat.tax),
      });
    if (has("payments"))
      closing.push({
        label: "Zaúčtované výpisy",
        value: num(p.totals.imports),
      });
    d.kpis(closing);
    d.heading("Zahrnuté datové zdroje");
    d.table(
      [
        { label: "Oblast", weight: 1.5 },
        { label: "Rozsah", weight: 3 },
      ],
      o.sections.map((section) => [
        REPORT_SECTIONS[section],
        section === "payments"
          ? `${num(p.totals.imports)} zaúčtovaných výpisů, ${num(p.totals.accepted)} přijatých řádků; celá firma, všechny měny.`
          : `${num(r.invoice_count)} vybraných faktur v ${q.currency}. ${REPORT_BASES[q.dateBasis]}.`,
      ]),
    );
    d.heading("Identifikace sestavy");
    d.paragraph(
      `${REPORT_MODES[o.mode]}. Sestaveno ${stamp(s.generated_at)} v časovém pásmu Europe/Prague. Patičky číslují skutečně vygenerované strany. Přehledy, tabulky a grafy vycházejí z jediného databázového snapshotu.`,
    );
    d.note(
      "Report neobsahuje doporučení ani předpovědi. Nejde o daňové přiznání ani historickou rekonstrukci pohledávek. Při překročení bezpečnostního limitu se export odmítne s vysvětlením; data se potichu nevynechávají.",
    );
  }
  return d.finish();
}
