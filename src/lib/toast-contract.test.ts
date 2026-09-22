import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const toast = () => read("src/components/toast.tsx");

// Projekt nema DOM prostredi pro testy, takze se tu overuji vlastnosti, ktere
// se daji cist ze zdroje. Jsou to prave ty, ktere v predchozim reseni chybely
// a zpusobovaly konkretni problemy -- ne libovolne detaily implementace.
describe("toast contract", () => {
  it("announces results to screen readers, which the ad-hoc notices did not", () => {
    // 8 z 10 klientu drive nemelo aria-live vubec.
    expect(toast()).toContain('aria-live="polite"');
    expect(toast()).toContain('aria-live="assertive"');
  });

  it("uses assertive only for errors, so success does not interrupt work", () => {
    const source = toast();
    const assertiveBlock = source.slice(source.indexOf('aria-live="assertive"'));
    expect(assertiveBlock).toContain('toast.variant === "error"');
  });

  it("dismisses success on its own but never an error", () => {
    // Hlasky drive nemizely vubec (nikde zadny setTimeout), takze po chvili
    // nebylo poznat, ke ktere akci patri. Chyba ale zmizet nesmi -- uzivatel
    // si ji potrebuje precist a casto opsat request_id.
    const source = toast();
    expect(source).toMatch(/success:\s*\d+/);
    expect(source).toMatch(/error:\s*null/);
  });

  it("lets every toast be closed by hand, with an accessible name", () => {
    expect(toast()).toContain('aria-label="Zavřít oznámení"');
  });

  it("carries an optional detail so a request id can reach the user", () => {
    expect(toast()).toContain("detail");
  });

  it("is mounted once for the whole workspace", () => {
    // Bez toho by si ho musela pripojit kazda stranka zvlast a vznikl by
    // jedenacty ad-hoc mechanismus.
    expect(read("src/app/(workspace)/layout.tsx")).toContain("ToastProvider");
  });
});

describe("message variant is carried by type, not guessed from text", () => {
  const settings = () => read("src/app/(workspace)/settings/settings-client.tsx");

  // Driv se barva hlasky odvozovala z toho, jestli text obsahoval slova jako
  // "ulozene" nebo "odebran". Uspesne odebrani clena konci na "byly smazany",
  // takze se uspech zobrazoval CERVENE jako chyba.
  it("no longer decides the colour by searching the message text", () => {
    const source = settings();
    expect(source).not.toContain('message.includes("uložené")');
    expect(source).not.toContain('message.includes("odebrán")');
    expect(source).toContain('message.variant === "success"');
  });

  it("marks removing a member as a success", () => {
    const source = settings();
    const removal = source.indexOf("Přístup i přihlašovací účet byly smazány");
    expect(removal).toBeGreaterThan(-1);
    // Hlaska musi vzniknout pres notifyOk, ne pres obecny setMessage.
    expect(source.slice(Math.max(0, removal - 200), removal)).toContain("notifyOk");
  });
});

describe("a failed refresh no longer hides the invoice table", () => {
  const invoices = () => read("src/app/(workspace)/invoices/invoices-client.tsx");

  it("reports load errors beside the content instead of replacing it", () => {
    const source = invoices();
    // Vterinovy vypadek site drive trvale schoval tabulku az do reloadu.
    expect(source).not.toContain('<p className="page-state error-state">{error}</p>');
    expect(source).toContain("showToast({ variant: \"error\", message: loadError.message })");
  });
});
