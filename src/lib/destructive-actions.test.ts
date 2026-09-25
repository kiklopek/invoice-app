import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const detail = () => read("src/app/(workspace)/invoices/[id]/invoice-detail-client.tsx");
const invoiceList = () => read("src/app/(workspace)/invoices/invoices-client.tsx");
const paymentChoice = () => read("src/components/optional-payment-assignment.tsx");
const reminders = () => read("src/app/(workspace)/reminders/reminders-client.tsx");
const gpc = () => read("src/app/(workspace)/invoices/payments/gpc-import-panel.tsx");
const archive = () => read("src/app/(workspace)/invoices/payments/archive/payments-archive-client.tsx");

/** Volá se confirmAction dřív, než se v dané funkci stane cokoli jiného? */
function confirmsBeforeActing(source: string, functionName: string) {
  const start = source.indexOf(`async function ${functionName}(`);
  if (start < 0) return false;
  const body = source.slice(start, start + 2000);
  const confirm = body.indexOf("confirmAction(");
  const fetchCall = body.search(/fetch\(|apiFetch[<(]|patch\(\{/);
  return confirm > -1 && (fetchCall === -1 || confirm < fetchCall);
}

describe("storno faktury", () => {
  // API storno umelo od zacatku (allowedStatus obsahuje "cancelled") a archiv
  // ma filtr "Pouze stornovane", ale zadne tlacitko ho nevolalo. Uzivateli
  // zbyvalo jen NEVRATNE smazani vydane faktury, coz je ucetne spatne.
  it("is reachable from the invoice detail", () => {
    expect(detail()).toContain('changeStatus("cancelled")');
    expect(detail()).toContain("Stornovat fakturu");
  });

  it("is offered only where the API allows it", () => {
    // Zaplacenou fakturu ani fakturu s castecnou uhradou server stornovat
    // nenecha -- nabizet to tlacitko by znamenalo slibovat chybu.
    const source = detail();
    // Retezec "Stornovat fakturu" je v souboru dvakrat: jako confirmLabel
    // v dialogu a jako popisek tlacitka. Zajima nas to druhe, v JSX.
    const button = source.lastIndexOf("Stornovat fakturu");
    const guard = source.slice(Math.max(0, button - 500), button);
    expect(guard).toContain('invoice.status === "pending"');
    expect(guard).toContain('invoice.status === "overdue"');
  });

  it("asks first, because the counterparty sees the result", () => {
    expect(detail()).toContain('confirmLabel: "Stornovat fakturu"');
  });
});

describe("akce, které nejdou vzít zpět, se ptají", () => {
  it("vyžaduje bankovní platbu nebo výslovné potvrzení ruční úhrady", () => {
    for (const source of [detail(), invoiceList()]) {
      expect(source).toContain("<OptionalPaymentAssignment");
      expect(source).toContain("!selectedBankPaymentId");
      expect(source).toContain("!confirmWithoutBankPayment");
      expect(source).toContain("assignBankPaymentToInvoice");
    }
    expect(paymentChoice()).toContain("Potvrdit úhradu bez přiřazení bankovní platby");
    expect(paymentChoice()).toContain("Bez přiřazení platby");
  });

  // Pravidlo: co odesila e-mail treti strane nebo meni penezni stav,
  // vyzaduje potvrzeni s uvedenim rozsahu dopadu. Mazani faktury dialog
  // melo uz drive -- nekonzistence byla horsi nez absence, protoze ucila
  // uzivatele, ze nebezpecne akce se ptaji.
  it("confirms before e-mailing an invoice to the counterparty", () => {
    expect(confirmsBeforeActing(detail(), "sendInvoiceEmail")).toBe(true);
  });

  it("confirms before a manual reminder run sends real e-mails", () => {
    expect(confirmsBeforeActing(reminders(), "runNow")).toBe(true);
    // Uvadi i rozsah dopadu, ne jen "Opravdu?".
    expect(reminders()).toContain("aktuálně čeká");
  });

  it("confirms before booking bank payments onto invoices", () => {
    expect(confirmsBeforeActing(gpc(), "commit")).toBe(true);
    expect(gpc()).toContain('confirmLabel: "Zaúčtovat"');
  });

  it("confirms before assigning a payment, just like releasing one already did", () => {
    expect(confirmsBeforeActing(archive(), "assign")).toBe(true);
  });
});

describe("hlavní přepínač automatu jde uložit tam, kde je", () => {
  // Přepínač „Automatické odesílání" se dřív dal uložit JEN tlačítkem uvnitř
  // sbalené sekce „Texty e-mailů" jinde na stránce. Uživatel tedy automat
  // vypnul, odešel -- a upomínky dál odcházely. Tichá a drahá chyba.
  it("offers a save control right next to the switch once it changes", () => {
    const source = reminders();
    const toggle = source.indexOf('role="switch"');
    expect(toggle).toBeGreaterThan(-1);
    const nearby = source.slice(toggle, toggle + 1400);
    expect(nearby).toContain("reminders-switch-save");
    expect(nearby).toContain("Uložit změnu");
    // A říká, co se stane, ne jen „neuloženo".
    expect(nearby).toContain("Automat bude");
  });

  it("styles that save bar so it reads as a pending change", () => {
    expect(read("src/app/minimal.css")).toContain(".reminders-switch-save");
  });
});

describe("produkční hygiena textů", () => {
  const userFacing = () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) files.push(path);
      }
    };
    walk("src");
    // /api/health je diagnostika pro provoz, ne text pro účetní.
    return files.filter(path => !path.includes("api/health"));
  };

  it("never tells the user to check a database migration", () => {
    // Koncový uživatel nemá jak "zkontrolovat databázovou migraci" --
    // technický detail patří do logu, uživateli srozumitelná věta.
    const offenders = userFacing().filter(path => /Zkontrolujte (poslední )?databázov/.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it("does not ship one customer's company name inside the code", () => {
    // Název firmy se bere z profilu; natvrdo v kódu by se objevil
    // u jiného zákazníka na dashboardu i na tištěném reportu.
    // Komentáře se nepočítají -- vysvětlení minulé chyby smí jméno zmínit.
    const withoutComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
    const offenders = userFacing().filter(path => withoutComments(read(path)).includes("R. Hlavica"));
    expect(offenders).toEqual([]);
  });

  it("derives the allowed e-mail domain from one constant", () => {
    // Doména byla opsaná v šesti hláškách a placeholderech.
    const offenders = userFacing()
      .filter(path => path.includes("(auth)"))
      .filter(path => read(path).includes("@hlavica.cz"));
    expect(offenders).toEqual([]);
  });
});

describe("chybný dokument v OCR frontě není slepá ulička", () => {
  const importPage = () => read("src/app/(workspace)/invoices/import/page.tsx");

  // Dřív tu byla jen věta s chybou a nic víc: u jednoho souboru se z toho
  // dalo dostat jen reloadem stránky, u fronty to blokovalo postup.
  it("offers a way forward from every failed document", () => {
    const source = importPage();
    const block = source.slice(source.indexOf('active?.status === "error"'), source.indexOf('active?.status === "error"') + 1200);
    expect(block).toContain("Zkusit znovu");
    expect(block).toContain("Přeskočit dokument");
    expect(block).toContain("Vyplnit ručně");
  });

  it("can actually retry and skip, not just show the buttons", () => {
    const source = importPage();
    expect(source).toContain("async function retryDocument(");
    expect(source).toContain("function skipDocument(");
  });

  it("can stop a long batch instead of forcing a tab close", () => {
    expect(importPage()).toContain("AbortController");
    expect(importPage()).toContain("Zastavit zpracování");
  });
});

describe("klávesnice a sliby v textu", () => {
  const settings = () => read("src/app/(workspace)/settings/settings-client.tsx");
  const importPage = () => read("src/app/(workspace)/invoices/import/page.tsx");

  // Účetní odbavuje stovky položek; mimo skutečný <form> Enter nedělal nic
  // a pokaždé bylo nutné trefit tlačítko myší.
  it("saves company settings with Enter from any field", () => {
    const source = settings();
    expect(source).toContain('id="company-settings-form"');
    expect(source).toContain("onSubmit={(event) => { event.preventDefault(); void save(); }}");
    // Tlačítko leží v hlavičce mimo sekci -- musí být propojené atributem form.
    expect(source).toContain('form="company-settings-form"');
    expect(source).toContain('type="submit"');
  });

  // Text sliboval "sem soubory přetáhněte", ale onDrop nikde nebyl:
  // fungoval jen nativní drop přímo na skrytý input, ne na okolní plochu.
  it("actually accepts dropped files, as the dropzone text promises", () => {
    const source = importPage();
    expect(source).toContain("onDrop=");
    expect(source).toContain("onDragOver=");
    expect(source).toContain("acceptDroppedFiles");
    // A dává najevo, že je soubor nad plochou.
    expect(source).toContain("is-dragging");
    expect(read("src/app/minimal.css")).toContain(".import-drop.is-dragging");
  });
});
