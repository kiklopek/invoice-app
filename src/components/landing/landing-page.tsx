import type { CSSProperties } from "react";
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

const nav = [
  { href: "#jak-to-funguje", label: "Jak to funguje" },
  { href: "#funkce", label: "Funkce" },
  { href: "#cenik", label: "Ceník" },
  { href: "#pro-koho", label: "Pro koho" },
];

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
  { label: "Banka", icon: "/landing/icons/bank.svg", x: "6%", y: 96, r: "7deg" },
  { label: "Účetnictví", icon: "/landing/icons/document.svg", x: "37%", y: 18, r: "10deg" },
  { label: "Excel", icon: "/landing/icons/spreadsheet.svg", x: "27%", y: 198, r: "8deg" },
  { label: "E-mail", icon: "/landing/icons/mail.svg", x: "60%", y: 186, r: "12deg" },
];
const CHAOS_ARCS = [
  "M102.3 87.3Q119.5 56.4 162.4 63.0",
  "M287.5 145.6Q300.2 155.3 301.5 169.1",
  "M291.3 315.0Q256.4 352.1 206.9 338.7",
  "M113.1 264.2Q81.2 256.0 78.5 232.2",
];

const PERSONAS = [
  {
    title: "Pro majitele firem",
    quote: "„Víte, co vám má přijít na účet, a můžete se soustředit na to podstatné.“",
    image: "/landing/persona-owner.webp",
    alt: "3D ilustrace majitele firmy s notebookem",
    width: 585,
  },
  {
    title: "Pro účetní a administrativu",
    quote: "„Méně dohledávání plateb, kontroly splatností a ruční práce. Více času na to, co má smysl.“",
    image: "/landing/persona-accountant.webp",
    alt: "3D ilustrace účetní s deskami",
    width: 600,
  },
];

type Tone = "red" | "amber" | "orange" | "green";

const attention: {
  invoice: string;
  customer: string;
  amount: string;
  due: string;
  status: string;
  tone: Tone;
}[] = [
  { invoice: "FV-2026-0012", customer: "ACME s.r.o.", amount: "125 000 Kč", due: "12. 3. 2026", status: "Po splatnosti", tone: "red" },
  { invoice: "FV-2026-0015", customer: "BetaTech", amount: "48 000 Kč", due: "15. 3. 2026", status: "Nejasná platba", tone: "amber" },
  { invoice: "FV-2026-0018", customer: "Studio K", amount: "29 900 Kč", due: "18. 3. 2026", status: "Čeká na úhradu", tone: "orange" },
];

function StatusPill({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span className={styles.pill} data-tone={tone}>
      {children}
    </span>
  );
}

function AttentionTable({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`${styles.attTable} ${compact ? styles.attCompact : ""}`} role="table" aria-label="Faktury, které vyžadují pozornost">
      <div className={styles.attRow} role="row" data-head>
        <span role="columnheader">Faktura</span>
        <span role="columnheader">Odběratel</span>
        <span role="columnheader">Částka</span>
        <span role="columnheader">Splatnost</span>
        <span role="columnheader">Stav</span>
      </div>
      {attention.map((r) => (
        <div className={styles.attRow} role="row" key={r.invoice}>
          <span role="cell">{r.invoice}</span>
          <span role="cell">{r.customer}</span>
          <span role="cell" className={styles.num}>{r.amount}</span>
          <span role="cell" className={styles.muted}>{r.due}</span>
          <span role="cell">
            <StatusPill tone={r.tone}>{r.status}</StatusPill>
          </span>
        </div>
      ))}
    </div>
  );
}

// Ukázková data v náhledu nástěnky. Čísla jsou ilustrační, ne reálný účet.
const bars = [
  { m: "Led", paid: 58, open: 30 },
  { m: "Úno", paid: 70, open: 34 },
  { m: "Bře", paid: 66, open: 28 },
  { m: "Dub", paid: 88, open: 40 },
  { m: "Kvě", paid: 52, open: 26 },
  { m: "Čer", paid: 92, open: 44 },
];

function DashboardPreview() {
  return (
    <div className={styles.dash} aria-hidden="true">
      <aside className={styles.dashSide}>
        <Logo inverted />
        <ul>
          <li data-active>
            <Home /> Nástěnka
          </li>
          <li>
            <FileText /> Faktury
          </li>
          <li>
            <Wallet /> Platby
          </li>
          <li>
            <Bell /> Upomínky
          </li>
          <li>
            <Users /> Kontakty
          </li>
          <li>
            <Chart /> Reporty
          </li>
        </ul>
      </aside>

      <div className={styles.dashMain}>
        <div className={styles.dashTop}>
          <div>
            <p className={styles.dashHello}>Dobré ráno, Tomáši!</p>
            <p className={styles.dashSub}>Většina faktur je v pořádku, 3 položky potřebují vaši pozornost.</p>
          </div>
          <span className={styles.dashSelect}>
            Posledních 30 dní <ChevronDown />
          </span>
        </div>

        <div className={styles.dashStats}>
          <div>
            <small>Celkem faktur</small>
            <strong><CountUp value={124} delay={450} /></strong>
            <em className={styles.up}>↑ 12 %</em>
          </div>
          <div>
            <small>Čeká na úhradu</small>
            <strong className={styles.toneOrange}><CountUp value={18} delay={530} /></strong>
            <em><CountUp value={1340000} step={1000} suffix=" Kč" delay={530} /></em>
          </div>
          <div>
            <small className={styles.toneRed}>Po splatnosti</small>
            <strong className={styles.toneRed}><CountUp value={7} delay={610} /></strong>
            <em className={styles.toneRed}><CountUp value={320000} step={1000} suffix=" Kč" delay={610} /></em>
          </div>
          <div>
            <small>Zaplaceno</small>
            <strong className={styles.toneGreen}><CountUp value={99} delay={690} /></strong>
            <em className={styles.toneGreen}><CountUp value={1980000} step={1000} suffix=" Kč" delay={690} /></em>
          </div>
        </div>

        <div className={styles.dashCharts}>
          <div className={styles.dashCard}>
            <small className={styles.dashCardTitle}>Příjmy v čase</small>
            <div className={styles.legend}>
              <span data-c="paid">Zaplaceno</span>
              <span data-c="open">Čeká na úhradu</span>
            </div>
            <div className={styles.bars}>
              {bars.map((b) => (
                <div key={b.m} className={styles.barCol}>
                  <div className={styles.barPair}>
                    <span style={{ height: `${b.paid}%` }} />
                    <span style={{ height: `${b.open}%` }} data-open />
                  </div>
                  <small>{b.m}</small>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.dashCard}>
            <small className={styles.dashCardTitle}>Stav faktur</small>
            <div className={styles.donutWrap}>
              <div className={styles.donut}>
                <div>
                  <strong><CountUp value={124} delay={500} /></strong>
                </div>
              </div>
              <ul className={styles.donutLegend}>
                <li data-c="paid">
                  Zaplaceno <b>99</b>
                </li>
                <li data-c="open">
                  Čeká na úhradu <b>18</b>
                </li>
                <li data-c="late">
                  Po splatnosti <b>7</b>
                </li>
                <li data-c="unclear">
                  Nejasná platba <b>4</b>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className={`${styles.dashCard} ${styles.dashAttention}`}>
          <div className={styles.dashCardHead}>
            <small className={styles.dashCardTitle}>
              Vyžaduje pozornost <span className={styles.count}>3</span>
            </small>
            <small className={styles.link}>Zobrazit všechny</small>
          </div>
          <AttentionTable compact />
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className={`${styles.page} ${inter.variable} ${caveat.variable}`}>
      <LandingMotion />
      <header className={styles.header}>
        <div className={`${styles.container} ${styles.headerInner}`}>
          <Link href="/" aria-label="Splatno – úvod">
            <Logo />
          </Link>
          <nav className={styles.nav} aria-label="Hlavní navigace">
            {nav.map((n) => (
              <a key={n.href} href={n.href}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className={styles.headerActions}>
            <Link href={LOGIN_HREF} className={styles.loginLink}>
              Přihlásit se
            </Link>
            <Link href={TRIAL_HREF} className={`${styles.btnPrimary} ${styles.btnSm}`}>
              <span>
                Vyzkoušet<span className={styles.hideXs}> zdarma</span>
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
              <span className={styles.eyebrowSoft}>Faktury pod kontrolou</span>
              <h1 className={styles.h1}>
                Faktury <br />
                pod kontrolou.
              </h1>
              <p className={styles.heroLead}>Od vystavení až po úhradu.</p>
              <p className={styles.heroText}>
                Splatno hlídá splatnosti, páruje platby a posílá upomínky.
                <br />
                Vy řešíte jen to, co opravdu potřebuje vaši pozornost.
              </p>
              <div className={styles.heroCtas}>
                <Link href={TRIAL_HREF} className={`${styles.btnPrimary} ${styles.btnLg}`}>
                  Vyzkoušet zdarma <ArrowRight />
                </Link>
                <LandingVideo />
              </div>
              <ul className={styles.trust}>
                <li>
                  <span><Zap /></span>
                  <div>
                    <strong>Rychlé spuštění</strong>
                    <small>Do 10 minut</small>
                  </div>
                </li>
                <li>
                  <span><Layers /></span>
                  <div>
                    <strong>Bez změny účetnictví</strong>
                    <small>Snadný import dat</small>
                  </div>
                </li>
                <li>
                  <span><Shield /></span>
                  <div>
                    <strong>Bezpečná data</strong>
                    <small>Dvoufázové ověření</small>
                  </div>
                </li>
              </ul>
            </div>

            <div className={styles.heroVisual}>
              <DashboardPreview />
              <Image
                src="/landing/mascot-wave.webp"
                alt=""
                width={640}
                height={554}
                className={styles.heroMascot}
                loading="eager"
              />
              <p className={`${styles.hand} ${styles.heroHand}`}>
                Vše důležité
                <br />
                na jednom místě.
              </p>
            </div>
          </div>
        </section>

        {/* PROBLÉM */}
        <section className={styles.section}>
          <div className={`${styles.container} ${styles.problemGrid}`}>
            <div data-reveal="">
              <span className={styles.eyebrow}>Známá situace?</span>
              <h2 className={styles.h2}>
                Faktury v účetnictví.
                <br />
                Platby v bance. Přehled v Excelu?
              </h2>
              <p className={styles.lead}>
                Firmy dnes často kontrolují platby ručně, dohledávají v bance, hlídají splatnosti a
                posílají upomínky jednotlivě. Je to zdlouhavé, nepřehledné a zbytečně vás to stojí
                čas.
              </p>
              <a href="#jak-to-funguje" className={styles.textLink}>
                Tohle už nemusíte dělat ručně. <ArrowRight />
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
                  key={card.label}
                  className={styles.chaosCard}
                  style={{ "--x": card.x, "--y": card.y, "--r": card.r } as CSSProperties}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- malé statické SVG */}
                  <img src={card.icon} alt="" width={64} height={64} />
                  <span>{card.label}</span>
                </div>
              ))}
              <p className={`${styles.hand} ${styles.chaosHand}`}>
                Příliš mnoho
                <br />
                systémů, málo přehledu.
              </p>
            </div>
          </div>
        </section>

        {/* JAK TO FUNGUJE */}
        <section className={styles.section} id="jak-to-funguje">
          <div className={styles.container}>
            <div className={styles.center} data-reveal="">
              <span className={styles.eyebrow}>Jak to funguje</span>
              <h2 className={`${styles.h2} ${styles.flow}`}>
                <span>Faktura</span>
                <ArrowRight />
                <span>Splatno hlídá</span>
                <ArrowRight />
                <span>Platba</span>
                <ArrowRight />
                <span>Hotovo.</span>
              </h2>
              <p className={styles.flowSub}>Jednoduchý proces, který vám šetří čas a přináší klid.</p>
            </div>

            <div className={styles.steps} data-reveal="steps">
              <article className={styles.step}>
                <div className={styles.stepArt} aria-hidden="true">
                  <div className={`${styles.mini} ${styles.miniInvoice}`}>
                    <p className={styles.miniHead}>
                      <span className={styles.miniIcon}><FileText /></span>Faktura
                    </p>
                    <small>Splatnost</small>
                    <p className={styles.miniDate}>
                      12. 3. 2026 <span className={styles.miniDateGo}><ArrowRight /></span>
                    </p>
                  </div>
                </div>
                <span className={styles.stepNo}>01</span>
                <h3>Hlídá splatnosti</h3>
                <p>Sleduje termíny a včas upozorní na rizikové faktury.</p>
              </article>

              <span className={styles.stepArrow} aria-hidden="true"><ArrowRight /></span>

              <article className={styles.step}>
                <div className={styles.stepArt} aria-hidden="true">
                  <div className={`${styles.mini} ${styles.miniRow} ${styles.miniPaid}`}>
                    <Bank className={styles.miniBank} />
                    <div>
                      <strong>Příchozí platba</strong>
                      <p>48 000 Kč</p>
                    </div>
                    <span className={styles.pill} data-tone="green">Spárováno</span>
                  </div>
                  <div className={`${styles.mini} ${styles.miniRow} ${styles.miniGhost}`}>
                    <Bank className={styles.miniBank} />
                    <div>
                      <strong>Příchozí platba</strong>
                      <p>29 900 Kč</p>
                    </div>
                    <span className={styles.pill} data-tone="green">Páruji…</span>
                  </div>
                </div>
                <span className={styles.stepNo}>02</span>
                <h3>Páruje platby</h3>
                <p>Automaticky rozpozná příchozí platby a spáruje je s fakturami.</p>
              </article>

              <span className={styles.stepArrow} aria-hidden="true"><ArrowRight /></span>

              <article className={styles.step}>
                <div className={styles.stepArt} aria-hidden="true">
                  <div className={`${styles.mini} ${styles.miniRow} ${styles.miniSent}`}>
                    <span className={styles.miniMail}><Mail /></span>
                    <div>
                      <strong>Upomínka odeslána</strong>
                      <small>Faktura č. FV-2026-0012</small>
                    </div>
                  </div>
                  <div className={`${styles.mini} ${styles.miniNext}`}>
                    <strong>Za 7 dní</strong>
                    <small>Automatická upomínka</small>
                  </div>
                </div>
                <span className={styles.stepNo}>03</span>
                <h3>Posílá upomínky</h3>
                <p>Automatizuje upomínky podle vašich pravidel. Profesionálně a včas.</p>
              </article>
            </div>
          </div>
        </section>

        {/* POZORNOST */}
        <section className={styles.section} id="funkce">
          <div className={`${styles.container} ${styles.attentionGrid}`}>
            <div data-reveal="">
              <span className={styles.eyebrowRed}>Vyžaduje pozornost</span>
              <h2 className={styles.h2}>Řešte jen to, co opravdu potřebuje vás.</h2>
              <p className={styles.lead}>
                Splatno automaticky zpracuje jasné případy. Nejasné platby a výjimky vám přehledně
                ukáže, abyste je mohli snadno vyřešit.
              </p>
              <Link href={LOGIN_HREF} className={styles.btnOutline}>
                Přihlásit se do aplikace <ArrowRight />
              </Link>
            </div>
            <div className={`${styles.card} ${styles.attentionCard}`} data-reveal="" style={{ "--i": 1 } as CSSProperties}>
              <div className={styles.dashCardHead}>
                <h3 className={styles.attentionTitle}>
                  Vyžaduje pozornost <span className={styles.count}>3</span>
                </h3>
                <span className={styles.link}>Zobrazit všechny</span>
              </div>
              <AttentionTable />
            </div>
          </div>
        </section>

        {/* PRO KOHO */}
        <section className={styles.section} id="pro-koho">
          <div className={styles.container}>
            <span className={styles.eyebrow}>Pro koho je Splatno</span>
            <h2 className={styles.h2Sm} data-reveal="">Pomáháme firmám, které chtějí mít své faktury pod kontrolou.</h2>
            <div className={styles.personas}>
              {PERSONAS.map((persona, index) => (
                <a key={persona.title} href="#cenik" className={styles.persona} data-reveal="" style={{ "--i": index + 1 } as CSSProperties}>
                  <div className={styles.personaArt}>
                    <Image src={persona.image} alt={persona.alt} width={persona.width} height={720} sizes="(max-width: 640px) 40vw, 260px" />
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
              <span className={styles.eyebrow}>Začněte ještě dnes</span>
              <h2 className={styles.h2}>Faktury nemusíte hlídat ručně.</h2>
              <p className={styles.lead}>Splatno je pohlídá od vystavení až po zaplacení.</p>
              <div className={styles.finalCtas}>
                <Link href={TRIAL_HREF} className={`${styles.btnPrimary} ${styles.btnLg}`}>
                  Vyzkoušet zdarma <ArrowRight />
                </Link>
                <small className={styles.muted}>Už máte účet? <Link href={LOGIN_HREF} className={styles.inlineLink}>Přihlaste se</Link></small>
              </div>
            </div>
            <div className={styles.finalArt} aria-hidden="true" data-reveal="" style={{ "--i": 1 } as CSSProperties}>
              <Image src="/landing/mascot-done.webp" alt="" width={600} height={511} className={styles.finalMascot} sizes="230px" />
              <p className={`${styles.hand} ${styles.finalHand}`}>
                Méně hlídání.
                <br />
                Více hotových faktur.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerInner}`}>
          <Logo />
          <nav aria-label="Patička">
            <a href="#funkce">Produkt</a>
            <a href="#cenik">Ceník</a>
            <a href={CONTACT_HREF}>Kontakt</a>
          </nav>
          <small className={styles.muted}>© {new Date().getFullYear()} Splatno</small>
        </div>
      </footer>
    </div>
  );
}
