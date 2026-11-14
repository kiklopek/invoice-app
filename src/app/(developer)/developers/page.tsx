import Link from "next/link";
import type { Metadata } from "next";
import styles from "./developers.module.css";

export const metadata: Metadata = { title: "API pro vývojáře | Splatno", description: "Napojte e-shop nebo firemní systém na faktury, zákazníky a platby ve Splatnu." };
const resources = [
  ["Faktury", "Vystavení z cen s DPH, seznam, detail a PDF.", "/invoices"],
  ["Zákazníci", "Kontakty, založení a změna e-mailu nebo telefonu.", "/customers"],
  ["Platby", "Čtení bankovních plateb a stavu přímého přiřazení.", "/payments"],
  ["Upomínky", "Historie doručení, pozastavení a obnovení plánování.", "/reminders"],
  ["Události", "Průběžné čtení změn faktur, včetně úhrad.", "/events"],
  ["Reporty a firma", "Finanční souhrny po měnách a fakturační údaje firmy.", "/reports · /company"],
];
const sample = `curl 'https://www.splatno.com/api/v1/invoices?limit=20' \\
  -H "Authorization: Bearer $SPLATNO_API_KEY"`;

export default function DevelopersPage() {
  return <main className={styles.page}>
    <header className={styles.header}><Link className={styles.brand} href="/">splatno<span> / vývojáři</span></Link><Link href="/settings">Správa API klíčů →</Link></header>
    <section className={styles.hero}>
      <p className={styles.eyebrow}>SPLATNO API · V1</p>
      <h1>Vaše systémy.<br />Jedna evidence faktur.</h1>
      <p className={styles.lead}>Propojte e-shop a firemní nástroje se Splatnem. Vystavujte faktury, stahujte PDF a sledujte úhrady přes jedno verzované rozhraní.</p>
      <div className={styles.actions}><a className={styles.primary} href="/api/v1/openapi">Otevřít OpenAPI specifikaci ↗</a><a href="#start">Začít s integrací ↓</a></div>
    </section>
    <section className={styles.start} id="start">
      <div><h2>První požadavek</h2><ol><li>Administrátor vytvoří klíč v <Link href="/settings">Nastavení → API a napojení</Link>.</li><li>Povolí jen potřebná oprávnění, například <code>invoices:read</code>.</li><li>Klíč uložíte na serveru a pošlete v hlavičce <code>Authorization</code>.</li></ol><p>Klíč patří jedné firmě. Do prohlížeče ani veřejného repozitáře nepatří. Zobrazí se pouze při vytvoření a administrátor jej může zrušit.</p></div>
      <div className={styles.example}><p>GET /api/v1/invoices</p><pre><code>{sample}</code></pre><p className={styles.caption}>Proměnnou SPLATNO_API_KEY nastavte ve svém serverovém prostředí.</p></div>
    </section>
    <section className={styles.section}><h2>Co můžete propojit</h2><div className={styles.grid}>{resources.map(([name,description,path])=><article className={styles.card} key={name}><h3>{name}</h3><p>{description}</p><code>{path}</code></article>)}</div></section>
    <section className={styles.section}><h2>Pravidla spolehlivé integrace</h2><div className={styles.rules}>
      <article><h3>Opakování bez duplicit</h3><p>Pro vytvoření faktury, zákazníka a odeslání použijte <code>Idempotency-Key</code>. Při výpadku opakujte stejný obsah se stejným klíčem. Změněný obsah stejné operace je konflikt.</p></article>
      <article><h3>Přesné částky</h3><p>Ceny posílejte nejlépe jako desetinné řetězce. API vrací částky se dvěma desetinnými místy. Při vystavení musí vypočtený součet odpovídat <code>expected_total</code>.</p></article>
      <article><h3>Jasná oprávnění</h3><p>Čtení, vystavení a odeslání mají oddělená oprávnění. Zápis počáteční úhrady vyžaduje navíc <code>payments:write</code> a výslovné potvrzení.</p></article>
      <article><h3>Limity a dohledání chyby</h3><p>Výchozí limit je 120 požadavků za minutu na klíč. Při odpovědi 429 respektujte <code>Retry-After</code>. Pro podporu uchovejte hlavičku <code>X-Request-Id</code>.</p></article>
    </div></section>
    <aside className={styles.note}><h2>Události a rozsah první verze</h2><p>Změny faktur čtěte z <code>/events</code> a ukládejte vrácený kurzor. Události zpracovávejte podle jejich ID a aktuální stav ověřujte v detailu faktury. Tato verze používá polling; odchozí webhooky a veřejné OCR nejsou součástí rozhraní.</p><p>Úplné datové modely, požadované hlavičky, oprávnění a chybové odpovědi najdete ve <a href="/api/v1/openapi">specifikaci OpenAPI</a>.</p></aside>
    <footer className={styles.footer}><Link href="/">← Zpět na Splatno</Link><span>API v1 · HTTPS · JSON</span></footer>
  </main>;
}
