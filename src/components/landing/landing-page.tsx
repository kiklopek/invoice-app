import { Fragment, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { Caveat, Inter } from "next/font/google";
import {
  ArrowRight,
  Bank,
  Bell,
  Chart,
  ChevronDown,
  ChevronRight,
  FileText,
  Home,
  Layers,
  Mail,
  RibbonMark,
  Shield,
  Users,
  Wallet,
  Zap,
} from "./landing-icons";
import { I18nProvider } from "@/i18n/client";
import type { Dictionary } from "@/i18n/dictionaries";
import { formatCzk, formatDate } from "@/i18n/format";
import { LanguageSwitcher } from "@/i18n/language-switcher";
import type { Locale } from "@/i18n/locales";
import { getDictionary, getLocale } from "@/i18n/server";
import { CountUp } from "./count-up";
import { LandingMotion } from "./landing-motion";
import { LandingVideo } from "./landing-video";
import { Pricing } from "./pricing";
import styles from "./landing.module.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--lp-font-sans",
  display: "swap",
});
const caveat = Caveat({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600"],
  variable: "--lp-font-hand",
  display: "swap",
});

// Landing je vstupní brána aplikace: výzvy vedou na registraci (založení
// firemního účtu), přihlášení na obecné /login. Firemní vstupy (/hlavica)
// se tu veřejně neukazují.
// TODO: ověřit, že schránka existuje, než stránka půjde ven.
const CONTACT_HREF = "mailto:info@splatno.cz";
const TRIAL_HREF = "/register";
const LOGIN_HREF = "/login";

const NAV = [
  { href: "#jak-to-funguje", key: "how" },
  { href: "#funkce", key: "features" },
  { href: "#cenik", key: "pricing" },
  { href: "#pro-koho", key: "audience" },
] as const;

function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className={`${styles.logo} ${inverted ? styles.logoInverted : ""}`}>
      <RibbonMark size={inverted ? 20 : 34} />
      <span>splatno</span>
    </span>
  );
}

// Karty „roztříštěných systémů“: pozice v souřadnicích 460×340 a natočení.
const CHAOS_CARDS = [
  { key: "bank", icon: "/landing/icons/bank.svg", x: "6%", y: 96, r: "7deg" },
  { key: "accounting", icon: "/landing/icons/document.svg", x: "37%", y: 18, r: "10deg" },
  { key: "excel", icon: "/landing/icons/spreadsheet.svg", x: "27%", y: 198, r: "8deg" },
  { key: "email", icon: "/landing/icons/mail.svg", x: "60%", y: 186, r: "12deg" },
] as const;
const CHAOS_ARCS = [
  "M102.3 87.3Q119.5 56.4 162.4 63.0",
  "M287.5 145.6Q300.2 155.3 301.5 169.1",
  "M291.3 315.0Q256.4 352.1 206.9 338.7",
  "M113.1 264.2Q81.2 256.0 78.5 232.2",
];

// Obrázky person; texty jsou ve slovníku ve stejném pořadí.
const PERSONA_ART = [
  { image: "/landing/persona-owner.webp", width: 585 },
  { image: "/landing/persona-accountant.webp", width: 600 },
];

type Tone = "red" | "amber" | "orange" | "green";

// Ukázkové faktury (ilustrační data). Splatnost jako ISO kvůli formátu podle jazyka.
const attention: {
  invoice: string;
  customer: string;
  amount: number;
  due: string;
  status: keyof Dictionary["landing"]["table"]["statuses"];
  tone: Tone;
}[] = [
  { invoice: "FV-2026-0012", customer: "ACME s.r.o.", amount: 125000, due: "2026-03-12T12:00:00", status: "overdue", tone: "red" },
  { invoice: "FV-2026-0015", customer: "BetaTech", amount: 48000, due: "2026-03-15T12:00:00", status: "unclear", tone: "amber" },
  { invoice: "FV-2026-0018", customer: "Studio K", amount: 29900, due: "2026-03-18T12:00:00", status: "waiting", tone: "orange" },
];

function StatusPill({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span className={styles.pill} data-tone={tone}>
      {children}
    </span>
  );
}

function AttentionTable({ t, locale, compact = false }: { t: Dictionary; locale: Locale; compact?: boolean }) {
  const table = t.landing.table;
  return (
    <div className={`${styles.attTable} ${compact ? styles.attCompact : ""}`} role="table" aria-label={table.aria} data-locale={locale}>
      <div className={styles.attRow} role="row" data-head>
        <span role="columnheader">{table.invoice}</span>
        <span role="columnheader">{table.customer}</span>
        <span role="columnheader">{table.amount}</span>
        <span role="columnheader">{table.due}</span>
        <span role="columnheader">{table.status}</span>
      </div>
      {attention.map((r) => (
        <div className={styles.attRow} role="row" key={r.invoice}>
          <span role="cell">{r.invoice}</span>
          <span role="cell">{r.customer}</span>
          <span role="cell" className={styles.num}>{formatCzk(locale, r.amount)}</span>
          <span role="cell" className={styles.muted}>{formatDate(locale, r.due, { short: compact })}</span>
          <span role="cell">
            <StatusPill tone={r.tone}>{table.statuses[r.status]}</StatusPill>
          </span>
        </div>
      ))}
    </div>
  );
}

// Ukázková data v náhledu nástěnky. Čísla jsou ilustrační, ne reálný účet.
// Výšky sloupců za leden–červen; názvy měsíců jsou ve slovníku.
const bars = [
  { paid: 58, open: 30 },
  { paid: 70, open: 34 },
  { paid: 66, open: 28 },
  { paid: 88, open: 40 },
  { paid: 52, open: 26 },
  { paid: 92, open: 44 },
];

function DashboardPreview({ t, locale }: { t: Dictionary; locale: Locale }) {
  const dash = t.landing.dash;
  return (
    <div className={styles.dash} aria-hidden="true">
      <aside className={styles.dashSide}>
        <Logo inverted />
        <ul>
          <li data-active>
            <Home /> {dash.nav.dashboard}
          </li>
          <li>
            <FileText /> {dash.nav.invoices}
          </li>
          <li>
            <Wallet /> {dash.nav.payments}
          </li>
          <li>
            <Bell /> {dash.nav.reminders}
          </li>
          <li>
            <Users /> {dash.nav.contacts}
          </li>
          <li>
            <Chart /> {dash.nav.reports}
          </li>
        </ul>
      </aside>

      <div className={styles.dashMain}>
        <div className={styles.dashTop}>
          <div>
            <p className={styles.dashHello}>{dash.hello}</p>
            <p className={styles.dashSub}>{dash.sub}</p>
          </div>
          <span className={styles.dashSelect}>
            {dash.period} <ChevronDown />
          </span>
        </div>

        <div className={styles.dashStats}>
          <div>
            <small>{dash.stats.total}</small>
            <strong><CountUp value={124} delay={450} locale={locale} /></strong>
            <em className={styles.up}>{dash.growth}</em>
          </div>
          <div>
            <small>{dash.stats.waiting}</small>
            <strong className={styles.toneOrange}><CountUp value={18} delay={530} locale={locale} /></strong>
            <em><CountUp value={1340000} step={1000} currency delay={530} locale={locale} /></em>
          </div>
          <div>
            <small className={styles.toneRed}>{dash.stats.overdue}</small>
            <strong className={styles.toneRed}><CountUp value={7} delay={610} locale={locale} /></strong>
            <em className={styles.toneRed}><CountUp value={320000} step={1000} currency delay={610} locale={locale} /></em>
          </div>
          <div>
            <small>{dash.stats.paid}</small>
            <strong className={styles.toneGreen}><CountUp value={99} delay={690} locale={locale} /></strong>
            <em className={styles.toneGreen}><CountUp value={1980000} step={1000} currency delay={690} locale={locale} /></em>
          </div>
        </div>

        <div className={styles.dashCharts}>
          <div className={styles.dashCard}>
            <small className={styles.dashCardTitle}>{dash.incomeTitle}</small>
            <div className={styles.legend}>
              <span data-c="paid">{dash.legend.paid}</span>
              <span data-c="open">{dash.legend.waiting}</span>
            </div>
            <div className={styles.bars}>
              {bars.map((b, index) => (
                <div key={index} className={styles.barCol}>
                  <div className={styles.barPair}>
                    <span style={{ height: `${b.paid}%` }} />
                    <span style={{ height: `${b.open}%` }} data-open />
                  </div>
                  <small>{dash.months[index]}</small>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.dashCard}>
            <small className={styles.dashCardTitle}>{dash.statusTitle}</small>
            <div className={styles.donutWrap}>
              <div className={styles.donut}>
                <div>
                  <strong><CountUp value={124} delay={500} locale={locale} /></strong>
                </div>
              </div>
              <ul className={styles.donutLegend}>
                <li data-c="paid">
                  {dash.legend.paid} <b>99</b>
                </li>
                <li data-c="open">
                  {dash.legend.waiting} <b>18</b>
                </li>
                <li data-c="late">
                  {dash.legend.overdue} <b>7</b>
                </li>
                <li data-c="unclear">
                  {dash.legend.unclear} <b>4</b>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className={`${styles.dashCard} ${styles.dashAttention}`}>
          <div className={styles.dashCardHead}>
            <small className={styles.dashCardTitle}>
              {dash.attentionTitle} <span className={styles.count}>3</span>
            </small>
            <small className={styles.link}>{dash.showAll}</small>
          </div>
          <AttentionTable t={t} locale={locale} compact />
        </div>
      </div>
    </div>
  );
}

export async function LandingPage() {
  const locale = await getLocale();
  const t = getDictionary(locale);
  const { header, hero, problem, how, attention: attentionCopy, audience, final, footer } = t.landing;

  return (
    <I18nProvider locale={locale}>
      <div className={`${styles.page} ${inter.variable} ${caveat.variable}`}>
        <LandingMotion />
        <header className={styles.header}>
          <div className={`${styles.container} ${styles.headerInner}`}>
            <Link href="/" aria-label={header.homeAria}>
              <Logo />
            </Link>
            <nav className={styles.nav} aria-label={header.navAria}>
              {NAV.map((n) => (
                <a key={n.href} href={n.href}>
                  {header.nav[n.key]}
                </a>
              ))}
            </nav>
            <div className={styles.headerActions}>
              <LanguageSwitcher className={styles.headerSwitcher} />
              <Link href={LOGIN_HREF} className={styles.loginLink}>
                {header.login}
              </Link>
              <Link href={TRIAL_HREF} className={`${styles.btnPrimary} ${styles.btnSm}`}>
                <span>
                  {header.trial}<span className={styles.hideXs}>{header.trialRest}</span>
                </span>
                <ArrowRight />
              </Link>
            </div>
          </div>
        </header>

        <main>
          {/* HERO */}
          <section className={styles.hero}>
            <div className={`${styles.container} ${styles.heroGrid}`}>
              <div className={styles.heroCopy}>
                <div className={styles.heroTop}>
                  <span className={styles.eyebrowSoft}>{hero.eyebrow}</span>
                  <LanguageSwitcher className={styles.heroSwitcher} />
                </div>
                <h1 className={styles.h1}>
                  {hero.titleLine1} <br />
                  {hero.titleLine2}
                </h1>
                <p className={styles.heroLead}>{hero.lead}</p>
                <p className={styles.heroText}>
                  {hero.text1}
                  <br />
                  {hero.text2}
                </p>
                <div className={styles.heroCtas}>
                  <Link href={TRIAL_HREF} className={`${styles.btnPrimary} ${styles.btnLg}`}>
                    {hero.cta} <ArrowRight />
                  </Link>
                  <LandingVideo />
                </div>
                <div className={styles.trustRow}>
                  <ul className={styles.trust}>
                    {[Zap, Layers, Shield].map((Icon, index) => (
                      <li key={hero.trust[index].title}>
                        <span><Icon /></span>
                        <div>
                          <strong>{hero.trust[index].title}</strong>
                          <small>{hero.trust[index].sub}</small>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {/* Na mobilu stojí maskot vedle výhod místo pod nástěnkou. */}
                  <Image
                    src="/landing/mascot-wave.webp"
                    alt=""
                    aria-hidden="true"
                    width={640}
                    height={554}
                    className={styles.trustMascot}
                    sizes="140px"
                  />
                </div>
              </div>

              <div className={styles.heroVisual}>
                <DashboardPreview t={t} locale={locale} />
                <Image
                  src="/landing/mascot-wave.webp"
                  alt=""
                  width={640}
                  height={554}
                  className={styles.heroMascot}
                  loading="eager"
                />
                <p className={`${styles.hand} ${styles.heroHand}`}>
                  {hero.hand1}
                  <br />
                  {hero.hand2}
                </p>
              </div>
            </div>
          </section>

          {/* PROBLÉM */}
          <section className={styles.section}>
            <div className={`${styles.container} ${styles.problemGrid}`}>
              <div data-reveal="">
                <span className={styles.eyebrow}>{problem.eyebrow}</span>
                <h2 className={styles.h2}>
                  {problem.titleLine1}
                  <br />
                  {problem.titleLine2}
                </h2>
                <p className={styles.lead}>{problem.lead}</p>
                <a href="#jak-to-funguje" className={styles.textLink}>
                  {problem.link} <ArrowRight />
                </a>
              </div>
              <div className={styles.chaos} aria-hidden="true" data-reveal="chaos">
                {/* Oblouky vypočtené z pozic a natočení karet, aby navazovaly na jejich hrany. */}
                <svg className={styles.chaosFlow} viewBox="0 0 460 340" fill="none" overflow="visible">
                  <defs>
                    <marker id="lp-arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M1 1 8 5 1 9" fill="none" stroke="#b7cdbf" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </marker>
                  </defs>
                  {CHAOS_ARCS.map((d) => (
                    <path key={d} d={d} pathLength={1} markerEnd="url(#lp-arrowhead)" />
                  ))}
                </svg>
                {CHAOS_CARDS.map((card) => (
                  <div
                    key={card.key}
                    className={styles.chaosCard}
                    style={{ "--x": card.x, "--y": card.y, "--r": card.r } as CSSProperties}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- malé statické SVG */}
                    <img src={card.icon} alt="" width={64} height={64} />
                    <span>{problem.cards[card.key]}</span>
                  </div>
                ))}
                <p className={`${styles.hand} ${styles.chaosHand}`}>
                  {problem.hand1}
                  <br />
                  {problem.hand2}
                </p>
              </div>
            </div>
          </section>

          {/* JAK TO FUNGUJE */}
          <section className={styles.section} id="jak-to-funguje">
            <div className={styles.container}>
              <div className={styles.center} data-reveal="">
                <span className={styles.eyebrow}>{how.eyebrow}</span>
                <h2 className={`${styles.h2} ${styles.flow}`}>
                  {how.flow.map((word, index) => (
                    <Fragment key={word}>
                      {index > 0 ? <ArrowRight /> : null}
                      <span>{word}</span>
                    </Fragment>
                  ))}
                </h2>
                <p className={styles.flowSub}>{how.sub}</p>
              </div>

              <div className={styles.steps} data-reveal="steps">
                <article className={styles.step}>
                  <div className={styles.stepArt} aria-hidden="true">
                    <div className={`${styles.mini} ${styles.miniInvoice}`}>
                      <p className={styles.miniHead}>
                        <span className={styles.miniIcon}><FileText /></span>{how.step1.art}
                      </p>
                      <small>{how.step1.due}</small>
                      <p className={styles.miniDate}>
                        {formatDate(locale, "2026-03-12T12:00:00")} <span className={styles.miniDateGo}><ArrowRight /></span>
                      </p>
                    </div>
                  </div>
                  <span className={styles.stepNo}>01</span>
                  <h3>{how.step1.title}</h3>
                  <p>{how.step1.text}</p>
                </article>

                <span className={styles.stepArrow} aria-hidden="true"><ArrowRight /></span>

                <article className={styles.step}>
                  <div className={styles.stepArt} aria-hidden="true">
                    <div className={`${styles.mini} ${styles.miniRow} ${styles.miniPaid}`}>
                      <Bank className={styles.miniBank} />
                      <div>
                        <strong>{how.step2.incoming}</strong>
                        <p>{formatCzk(locale, 48000)}</p>
                      </div>
                      <span className={styles.pill} data-tone="green">{how.step2.matched}</span>
                    </div>
                    <div className={`${styles.mini} ${styles.miniRow} ${styles.miniGhost}`}>
                      <Bank className={styles.miniBank} />
                      <div>
                        <strong>{how.step2.incoming}</strong>
                        <p>{formatCzk(locale, 29900)}</p>
                      </div>
                      <span className={styles.pill} data-tone="green">{how.step2.matching}</span>
                    </div>
                  </div>
                  <span className={styles.stepNo}>02</span>
                  <h3>{how.step2.title}</h3>
                  <p>{how.step2.text}</p>
                </article>

                <span className={styles.stepArrow} aria-hidden="true"><ArrowRight /></span>

                <article className={styles.step}>
                  <div className={styles.stepArt} aria-hidden="true">
                    <div className={`${styles.mini} ${styles.miniRow} ${styles.miniSent}`}>
                      <span className={styles.miniMail}><Mail /></span>
                      <div>
                        <strong>{how.step3.sent}</strong>
                        <small>{how.step3.invoiceNo("FV-2026-0012")}</small>
                      </div>
                    </div>
                    <div className={`${styles.mini} ${styles.miniNext}`}>
                      <strong>{how.step3.next}</strong>
                      <small>{how.step3.auto}</small>
                    </div>
                  </div>
                  <span className={styles.stepNo}>03</span>
                  <h3>{how.step3.title}</h3>
                  <p>{how.step3.text}</p>
                </article>
              </div>
            </div>
          </section>

          {/* POZORNOST */}
          <section className={styles.section} id="funkce">
            <div className={`${styles.container} ${styles.attentionGrid}`}>
              <div data-reveal="">
                <span className={styles.eyebrowRed}>{attentionCopy.eyebrow}</span>
                <h2 className={styles.h2}>{attentionCopy.title}</h2>
                <p className={styles.lead}>{attentionCopy.lead}</p>
                <Link href={LOGIN_HREF} className={`${styles.btnOutline} ${styles.attentionLogin}`}>
                  {attentionCopy.login} <ArrowRight />
                </Link>
              </div>
              <div className={`${styles.card} ${styles.attentionCard}`} data-reveal="" style={{ "--i": 1 } as CSSProperties}>
                <div className={styles.dashCardHead}>
                  <h3 className={styles.attentionTitle}>
                    {attentionCopy.cardTitle} <span className={styles.count}>3</span>
                  </h3>
                  <span className={styles.link}>{attentionCopy.showAll}</span>
                </div>
                <AttentionTable t={t} locale={locale} />
              </div>
            </div>
          </section>

          {/* PRO KOHO */}
          <section className={styles.section} id="pro-koho">
            <div className={styles.container}>
              <span className={styles.eyebrow}>{audience.eyebrow}</span>
              <h2 className={styles.h2Sm} data-reveal="">{audience.title}</h2>
              <div className={styles.personas}>
                {audience.personas.map((persona, index) => (
                  <a key={persona.title} href="#cenik" className={styles.persona} data-reveal="" style={{ "--i": index + 1 } as CSSProperties}>
                    <div className={styles.personaArt}>
                      <Image src={PERSONA_ART[index].image} alt={persona.alt} width={PERSONA_ART[index].width} height={720} sizes="(max-width: 640px) 40vw, 260px" />
                    </div>
                    <div className={styles.personaCopy}>
                      <h3>{persona.title}</h3>
                      <p>{persona.quote}</p>
                    </div>
                    <ChevronRight className={styles.personaChevron} />
                  </a>
                ))}
              </div>
            </div>
          </section>

          {/* CENÍK */}
          <section className={styles.section} id="cenik">
            <div className={styles.container}>
              <Pricing contactHref={CONTACT_HREF} trialHref={TRIAL_HREF} />
            </div>
          </section>

          {/* FINÁLNÍ CTA */}
          <section className={styles.final}>
            <div className={`${styles.container} ${styles.finalGrid}`}>
              <div data-reveal="">
                <span className={styles.eyebrow}>{final.eyebrow}</span>
                <h2 className={styles.h2}>{final.title}</h2>
                <p className={styles.lead}>{final.lead}</p>
                <div className={styles.finalCtas}>
                  <Link href={TRIAL_HREF} className={`${styles.btnPrimary} ${styles.btnLg}`}>
                    {final.cta} <ArrowRight />
                  </Link>
                  <small className={styles.muted}>{final.haveAccount} <Link href={LOGIN_HREF} className={styles.inlineLink}>{final.login}</Link></small>
                </div>
              </div>
              <div className={styles.finalArt} aria-hidden="true" data-reveal="" style={{ "--i": 1 } as CSSProperties}>
                <Image src="/landing/mascot-done.webp" alt="" width={600} height={511} className={styles.finalMascot} sizes="230px" />
                <p className={`${styles.hand} ${styles.finalHand}`}>
                  {final.hand1}
                  <br />
                  {final.hand2}
                </p>
              </div>
            </div>
          </section>
        </main>

        <footer className={styles.footer}>
          <div className={`${styles.container} ${styles.footerInner}`}>
            <Logo />
            <nav aria-label={footer.navAria}>
              <a href="#funkce">{footer.product}</a>
              <a href="#cenik">{footer.pricing}</a>
              <a href={CONTACT_HREF}>{footer.contact}</a>
            </nav>
            <LanguageSwitcher className={styles.footerSwitcher} />
            <small className={styles.muted}>© {new Date().getFullYear()} Splatno</small>
          </div>
        </footer>
      </div>
    </I18nProvider>
  );
}
