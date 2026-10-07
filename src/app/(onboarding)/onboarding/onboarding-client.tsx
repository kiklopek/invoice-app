"use client";

import Image from "next/image";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Bank, Check, Home, Mail, Users } from "@/components/landing/landing-icons";
import { RibbonMark } from "@/components/landing/landing-icons";
import { isValidBankAccount, isValidIco } from "@/lib/company-validation";
import { confirmAction } from "@/lib/confirm-action";
import { isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { normalizeOnboardingCompany, validateOnboardingCompany, type OnboardingCompany } from "@/lib/onboarding";
import { roleNames, type AccessRole } from "@/lib/role-access";
import styles from "./onboarding.module.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap" });

type Step = 1 | 2 | 3 | 4 | 5;
type Invite = { email: string; role: AccessRole };
type AresState = "idle" | "loading" | "found" | "not_found" | "unavailable";

const STEPS: { title: string; sub: string }[] = [
  { title: "Vaše firma", sub: "IČO a základní údaje" },
  { title: "Kontakt", sub: "Kam vám psát" },
  { title: "Bankovní účet", sub: "Kam vám chodí platby" },
  { title: "Tým", sub: "Pozvěte kolegy" },
  { title: "Hotovo", sub: "Kontrola a spuštění" },
];

const ART: Record<Step, { src: string; title: string; sub: string }> = {
  1: { src: "/brand/mascot/wave.webp", title: "Vítejte ve Splatnu.", sub: "Podle IČO doplníme údaje z obchodního rejstříku." },
  2: { src: "/brand/mascot/phone.webp", title: "Odpovědi vám přijdou sem.", sub: "Z tohoto e-mailu uvidí zákazníci faktury a upomínky." },
  3: { src: "/brand/mascot/laptop.webp", title: "Platby spárujeme za vás.", sub: "Číslo účtu ověříme kontrolní číslicí, ať se nepáruje na překlep." },
  4: { src: "/brand/mascot/wave.webp", title: "Společně to zvládneme.", sub: "Kolegy pozvete teď, nebo kdykoli později v Nastavení." },
  5: { src: "/brand/mascot/laptop.webp", title: "Faktury pod kontrolou.", sub: "Upomínky zůstanou vypnuté, dokud je sami nezapnete." },
};

const DRAFT_KEY = "splatno:onboarding-draft";
const EMPTY: OnboardingCompany = normalizeOnboardingCompany({});

function readDraft(): { company: OnboardingCompany; invites: Invite[] } | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { company?: unknown; invites?: unknown };
    const invites = Array.isArray(parsed.invites)
      ? parsed.invites.filter((invite): invite is Invite =>
          typeof invite?.email === "string" && ["viewer", "accounting", "admin"].includes(invite?.role))
      : [];
    return { company: normalizeOnboardingCompany(parsed.company), invites };
  } catch {
    return null;
  }
}

function writeDraft(value: { company: OnboardingCompany; invites: Invite[] } | null) {
  try {
    if (value) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Bez úložiště se rozpracovaný onboarding jen nezapamatuje.
  }
}

// Průvodce založením firmy. Nic se nezakládá průběžně: firma vznikne naráz
// až tlačítkem „Dokončit nastavení“ (R3). Rozpracované údaje se drží jen
// v prohlížeči, takže zavření stránky nic napůl nezaloží.
export function OnboardingClient({ accountEmail, accountName }: { accountEmail: string; accountName: string }) {
  const [step, setStep] = useState<Step>(1);
  const [reached, setReached] = useState<Step>(1);
  const [company, setCompany] = useState<OnboardingCompany>({ ...EMPTY, email: accountEmail });
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AccessRole>("accounting");
  const [ares, setAres] = useState<AresState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      setCompany({ ...draft.company, email: draft.company.email || accountEmail });
      setInvites(draft.invites);
    }
  }, [accountEmail]);

  useEffect(() => {
    writeDraft({ company, invites });
  }, [company, invites]);

  const allErrors = useMemo(() => validateOnboardingCompany(company), [company]);

  function update(field: keyof OnboardingCompany, value: string) {
    setCompany((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function lookupIco(rawIco: string) {
    const ico = rawIco.replace(/\s/g, "");
    if (!isValidIco(ico)) return;
    setAres("loading");
    try {
      const response = await fetch("/api/onboarding/ares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ico }),
      });
      const data = await response.json().catch(() => null) as
        | { status?: string; subject?: { name: string; dic: string | null; address: string | null } }
        | null;
      if (data?.status === "found" && data.subject) {
        const subject = data.subject;
        setCompany((current) => ({
          ...current,
          name: current.name || subject.name,
          dic: current.dic || subject.dic || "",
          registered_address: current.registered_address || subject.address || "",
        }));
        setAres("found");
      } else {
        setAres(data?.status === "not_found" ? "not_found" : "unavailable");
      }
    } catch {
      setAres("unavailable");
    }
  }

  // Kontrola polí jednoho kroku; ostatní kroky se kontrolují až na nich.
  function validateStep(target: Step) {
    const fields: Record<number, (keyof OnboardingCompany)[]> = {
      1: ["name", "ico", "dic"],
      2: ["email"],
      3: ["bank_account_czk", "bank_account_eur"],
    };
    const relevant = fields[target] ?? [];
    const errors = Object.fromEntries(
      allErrors.filter((item) => relevant.includes(item.field as keyof OnboardingCompany)).map((item) => [item.field, item.message]),
    );
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function go(next: Step) {
    setError(null);
    if (next > step && !validateStep(step)) return;
    setStep(next);
    setReached((current) => (next > current ? next : current));
  }

  function addInvite() {
    const email = normalizeEmail(inviteEmail);
    if (!isValidEmail(email)) return setError("Zadejte platný e-mail kolegy.");
    if (email === normalizeEmail(accountEmail)) return setError("Sebe zvát nemusíte, budete administrátor firmy.");
    if (invites.some((invite) => invite.email === email)) return setError("Tento e-mail už v seznamu je.");
    setError(null);
    setInvites((current) => [...current, { email, role: inviteRole }]);
    setInviteEmail("");
  }

  async function finish() {
    setError(null);
    const problems = validateOnboardingCompany(company);
    if (problems.length) {
      setError(problems[0].message);
      return;
    }
    // R6: e-mail třetí straně jen po potvrzení s rozsahem dopadu.
    if (invites.length) {
      const confirmed = await confirmAction({
        title: invites.length === 1 ? "Poslat 1 pozvánku?" : `Poslat ${invites.length} pozvánky?`,
        description: `Po založení firmy odejde pozvánka na: ${invites.map((invite) => `${invite.email} (${roleNames[invite.role]})`).join(", ")}.`,
        confirmLabel: "Založit firmu a poslat",
        confirmVariant: "primary",
      });
      if (!confirmed) return;
    }

    setSubmitting(true);
    const response = await fetch("/api/onboarding/organization", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(company),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { error?: string; code?: string; fields?: { field: string; message: string }[] } | null;
    if (!response?.ok) {
      if (data?.code === "already_member") {
        writeDraft(null);
        window.location.replace("/dashboard");
        return;
      }
      if (data?.fields) setFieldErrors(Object.fromEntries(data.fields.map((item) => [item.field, item.message])));
      setError(data?.error ?? "Firmu se nepodařilo založit. Zkontrolujte připojení a zkuste to znovu.");
      setSubmitting(false);
      return;
    }

    // Firma existuje. Pozvánky jdou po jedné; nepovedená se dá poslat znovu
    // v Nastavení → Tým, firma tím nijak neutrpí.
    const failed: string[] = [];
    for (const invite of invites) {
      const sent = await fetch("/api/settings/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invite),
      }).then(async (inviteResponse) => {
        const body = await inviteResponse.json().catch(() => null) as { invitation?: { sent?: boolean } } | null;
        return inviteResponse.ok && body?.invitation?.sent === true;
      }).catch(() => false);
      if (!sent) failed.push(invite.email);
    }
    writeDraft(null);
    if (failed.length) {
      setResult(`Firma je založená. Pozvánku se nepodařilo poslat na: ${failed.join(", ")}. Pošlete ji znovu v Nastavení → Tým.`);
      setSubmitting(false);
      return;
    }
    window.location.replace("/dashboard");
  }

  const art = ART[step];
  const icoTag = ares === "loading" ? { text: "Hledám v ARES…", tone: "ok" }
    : ares === "found" ? { text: "Doplněno z ARES", tone: "ok" }
    : ares === "not_found" ? { text: "V ARES nenalezeno", tone: "warn" }
    : ares === "unavailable" ? { text: "ARES nedostupný", tone: "warn" }
    : null;

  return (
    <main className={`${styles.page} ${inter.className}`}>
      <div className={styles.card}>
        <aside className={styles.rail} aria-label="Postup nastavení">
          <Link href="/" className={styles.logo} aria-label="Splatno"><RibbonMark size={34} /><span>splatno</span></Link>
          <ol className={styles.steps}>
            {STEPS.map((item, index) => {
              const number = (index + 1) as Step;
              const state = number === step ? "current" : number < reached || (number < step) ? "done" : "todo";
              return (
                <li key={item.title} data-state={state}>
                  <button type="button" disabled={number > reached || submitting} onClick={() => go(number)} aria-current={number === step ? "step" : undefined}>
                    <span className={styles.dot}>{state === "done" ? <Check /> : number}</span>
                    <span className={styles.stepTitle}>{item.title}</span>
                    <span className={styles.stepSub}>{item.sub}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className={styles.railFoot}>Přihlášen(a) jako {accountName}. Zabere to pár minut.</p>
        </aside>

        <section className={styles.main}>
          <div className={styles.pane}>
            <span className={styles.chip}>Krok {step} z 5</span>

            {step === 1 && (
              <>
                <h1 className={styles.title}>Řekněte nám o vaší firmě</h1>
                <p className={styles.sub}>Zadejte IČO a údaje doplníme z registru ARES. Vše můžete upravit.</p>
                <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); go(2); }}>
                  <label className={styles.field}>
                    <span className={styles.label}>IČO</span>
                    <span className={styles.control}>
                      <Home />
                      <input inputMode="numeric" autoComplete="off" maxLength={10} placeholder="12345678" value={company.ico}
                        aria-invalid={Boolean(fieldErrors.ico)}
                        onChange={(event) => {
                          const value = event.target.value.replace(/[^\d\s]/g, "");
                          update("ico", value);
                          setAres("idle");
                          if (value.replace(/\s/g, "").length === 8) void lookupIco(value);
                        }} />
                      {icoTag ? <span className={styles.tag} data-tone={icoTag.tone}>{icoTag.text}</span> : null}
                    </span>
                    {fieldErrors.ico ? <p className={styles.fieldError}>{fieldErrors.ico}</p> : null}
                    {ares === "unavailable" ? <p className={styles.hint}>Registr teď neodpovídá. Údaje prosím vyplňte ručně.</p> : null}
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Název firmy</span>
                    <span className={styles.control}><Home /><input autoComplete="organization" placeholder="Např. ACME s.r.o." value={company.name} aria-invalid={Boolean(fieldErrors.name)} onChange={(event) => update("name", event.target.value)} /></span>
                    {fieldErrors.name ? <p className={styles.fieldError}>{fieldErrors.name}</p> : null}
                  </label>
                  <div className={styles.pair}>
                    <label className={styles.field}>
                      <span className={styles.label}>DIČ <small>(nepovinné)</small></span>
                      <span className={`${styles.control} ${styles.plain}`}><input autoComplete="off" placeholder="CZ12345678" value={company.dic} aria-invalid={Boolean(fieldErrors.dic)} onChange={(event) => update("dic", event.target.value)} /></span>
                      {fieldErrors.dic ? <p className={styles.fieldError}>{fieldErrors.dic}</p> : null}
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Sídlo</span>
                      <span className={`${styles.control} ${styles.plain}`}><input autoComplete="street-address" placeholder="Ulice 1, 110 00 Praha" value={company.registered_address} onChange={(event) => update("registered_address", event.target.value)} /></span>
                    </label>
                  </div>
                  <div className={styles.actions}>
                    <button className={styles.primary} type="submit">Pokračovat <ArrowRight /></button>
                  </div>
                </form>
              </>
            )}

            {step === 2 && (
              <>
                <h1 className={styles.title}>Kam vám mají zákazníci psát?</h1>
                <p className={styles.sub}>Tyto údaje se objeví na fakturách a v upomínkách.</p>
                <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); go(3); }}>
                  <label className={styles.field}>
                    <span className={styles.label}>E-mail pro faktury a odpovědi</span>
                    <span className={styles.control}><Mail /><input type="email" autoComplete="email" placeholder="faktury@firma.cz" value={company.email} aria-invalid={Boolean(fieldErrors.email)} onChange={(event) => update("email", event.target.value)} /></span>
                    {fieldErrors.email ? <p className={styles.fieldError}>{fieldErrors.email}</p> : <p className={styles.hint}>Na tuto adresu přijdou odpovědi zákazníků na upomínky.</p>}
                  </label>
                  <div className={styles.pair}>
                    <label className={styles.field}>
                      <span className={styles.label}>Telefon <small>(nepovinné)</small></span>
                      <span className={`${styles.control} ${styles.plain}`}><input type="tel" autoComplete="tel" placeholder="+420 777 123 456" value={company.phone} onChange={(event) => update("phone", event.target.value)} /></span>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Datová schránka <small>(nepovinné)</small></span>
                      <span className={`${styles.control} ${styles.plain}`}><input autoComplete="off" placeholder="abc1234" value={company.data_box_id} onChange={(event) => update("data_box_id", event.target.value)} /></span>
                    </label>
                  </div>
                  <label className={styles.field}>
                    <span className={styles.label}>Provozovna <small>(pokud se liší od sídla)</small></span>
                    <span className={`${styles.control} ${styles.plain}`}><input autoComplete="off" value={company.operating_address} onChange={(event) => update("operating_address", event.target.value)} /></span>
                  </label>
                  <div className={styles.actions}>
                    <button className={styles.back} type="button" onClick={() => go(1)}><ArrowLeft />Zpět</button>
                    <button className={styles.primary} type="submit">Pokračovat <ArrowRight /></button>
                  </div>
                </form>
              </>
            )}

            {step === 3 && (
              <>
                <h1 className={styles.title}>Kam vám chodí platby?</h1>
                <p className={styles.sub}>Podle čísla účtu Splatno pozná příchozí platby a spáruje je s fakturami.</p>
                <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); go(4); }}>
                  <label className={styles.field}>
                    <span className={styles.label}>Účet v korunách</span>
                    <span className={styles.control}>
                      <Bank />
                      <input inputMode="numeric" autoComplete="off" placeholder="19-2000145399/0800" value={company.bank_account_czk} aria-invalid={Boolean(fieldErrors.bank_account_czk)} onChange={(event) => update("bank_account_czk", event.target.value)} />
                      {company.bank_account_czk && isValidBankAccount(company.bank_account_czk) ? <span className={styles.tag}>Číslo ověřeno</span> : null}
                    </span>
                    {fieldErrors.bank_account_czk ? <p className={styles.fieldError}>{fieldErrors.bank_account_czk}</p> : <p className={styles.hint}>Ve tvaru předčíslí-číslo/kód banky.</p>}
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Účet v eurech <small>(nepovinné)</small></span>
                    <span className={styles.control}>
                      <Bank />
                      <input inputMode="numeric" autoComplete="off" value={company.bank_account_eur} aria-invalid={Boolean(fieldErrors.bank_account_eur)} onChange={(event) => update("bank_account_eur", event.target.value)} />
                    </span>
                    {fieldErrors.bank_account_eur ? <p className={styles.fieldError}>{fieldErrors.bank_account_eur}</p> : null}
                  </label>
                  <div className={styles.info}><Bank /><p><b>Výpisy nahrajete v sekci Platby.</b> Zatím umíme výpisy Komerční banky ve formátu GPC, další banky připravujeme.</p></div>
                  <div className={styles.actions}>
                    <button className={styles.back} type="button" onClick={() => go(2)}><ArrowLeft />Zpět</button>
                    <button className={styles.primary} type="submit">Pokračovat <ArrowRight /></button>
                  </div>
                </form>
              </>
            )}

            {step === 4 && (
              <>
                <h1 className={styles.title}>Pozvěte kolegy</h1>
                <p className={styles.sub}>Každý dostane e-mail s odkazem, nastaví si heslo a hned uvidí vaši firmu. Pozvánky odejdou až po vašem potvrzení na konci.</p>
                <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); addInvite(); }}>
                  <div className={styles.inviteRow}>
                    <label className={styles.field}>
                      <span className={styles.label}>E-mail kolegy</span>
                      <span className={styles.control}><Mail /><input type="email" autoComplete="off" placeholder="kolega@firma.cz" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></span>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Role</span>
                      <span className={`${styles.control} ${styles.plain}`}>
                        <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as AccessRole)}>
                          <option value="accounting">{roleNames.accounting}</option>
                          <option value="viewer">{roleNames.viewer}</option>
                          <option value="admin">{roleNames.admin}</option>
                        </select>
                      </span>
                    </label>
                    <button type="submit" className={styles.addButton}>Přidat</button>
                  </div>
                  {invites.length ? (
                    <ul className={styles.invites}>
                      {invites.map((invite) => (
                        <li key={invite.email}>
                          <b>{invite.email}</b>
                          <span>{roleNames[invite.role]}</span>
                          <button type="button" className={styles.remove} onClick={() => setInvites((current) => current.filter((item) => item.email !== invite.email))}>Odebrat</button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.hint}>Účetní pracuje s fakturami a platbami, čtenář jen nahlíží, administrátor spravuje i firmu a tým.</p>
                  )}
                  {error && <p className={styles.notice}>{error}</p>}
                  <div className={styles.actions}>
                    <button className={styles.back} type="button" onClick={() => go(3)}><ArrowLeft />Zpět</button>
                    <button className={styles.primary} type="button" onClick={() => go(5)}>{invites.length ? "Pokračovat" : "Přeskočit, pozvu později"} <ArrowRight /></button>
                  </div>
                </form>
              </>
            )}

            {step === 5 && (
              <>
                <h1 className={styles.title}>Zkontrolujte a spusťte</h1>
                <p className={styles.sub}>Firma vznikne až tímto tlačítkem. Cokoli později změníte v Nastavení.</p>
                <ul className={styles.summary}>
                  <li>
                    <span className={styles.summaryIcon}><Home /></span>
                    <span><b>{company.name || "Název chybí"}</b><small>IČO {company.ico || "chybí"}{company.dic ? ` · DIČ ${company.dic}` : ""}{company.registered_address ? ` · ${company.registered_address}` : ""}</small></span>
                    <button type="button" onClick={() => go(1)}>Upravit</button>
                  </li>
                  <li>
                    <span className={styles.summaryIcon}><Mail /></span>
                    <span><b>{company.email || "E-mail chybí"}</b><small>{[company.phone, company.data_box_id ? `DS ${company.data_box_id}` : ""].filter(Boolean).join(" · ") || "Bez telefonu a datové schránky"}</small></span>
                    <button type="button" onClick={() => go(2)}>Upravit</button>
                  </li>
                  <li>
                    <span className={styles.summaryIcon}><Bank /></span>
                    <span><b>{company.bank_account_czk || "Účet chybí"}</b><small>{company.bank_account_eur ? `EUR ${company.bank_account_eur}` : "Bez eurového účtu"}</small></span>
                    <button type="button" onClick={() => go(3)}>Upravit</button>
                  </li>
                  <li data-optional={invites.length ? undefined : ""}>
                    <span className={styles.summaryIcon}><Users /></span>
                    <span><b>{invites.length ? `${invites.length} ${invites.length === 1 ? "pozvánka" : invites.length < 5 ? "pozvánky" : "pozvánek"}` : "Zatím bez kolegů"}</b><small>{invites.length ? invites.map((invite) => invite.email).join(", ") : "Pozvete je kdykoli v Nastavení → Tým"}</small></span>
                    <button type="button" onClick={() => go(4)}>Upravit</button>
                  </li>
                </ul>
                {error && <p className={styles.notice} style={{ marginTop: 16 }}>{error}</p>}
                {result ? (
                  <>
                    <p className={styles.notice} style={{ marginTop: 16 }}>{result}</p>
                    <div className={styles.actions} style={{ marginTop: 20 }}>
                      <a className={styles.primary} href="/dashboard">Přejít na nástěnku <ArrowRight /></a>
                    </div>
                  </>
                ) : (
                  <div className={styles.actions} style={{ marginTop: 24 }}>
                    <button className={styles.back} type="button" disabled={submitting} onClick={() => go(4)}><ArrowLeft />Zpět</button>
                    <button className={styles.primary} type="button" disabled={submitting} onClick={finish}>
                      {submitting ? "Zakládám firmu…" : "Dokončit nastavení"} <ArrowRight />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <aside className={styles.art} aria-hidden="true">
          <Image src={art.src} alt="" width={760} height={662} className={styles.mascot} sizes="380px" priority />
          <p className={styles.artTitle}>{art.title}</p>
          <p className={styles.artSub}>{art.sub}</p>
        </aside>
      </div>
    </main>
  );
}
