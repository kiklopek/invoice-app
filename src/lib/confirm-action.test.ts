// @vitest-environment jsdom
//
// DOM prostředí se zapíná jen pro tenhle soubor, ne globálně -- vitest.config.mts
// zůstává nedotčený, takže zbylých 600+ testů dál běží v Node a nezpomalí se.

import { afterEach, describe, expect, it } from "vitest";
import { confirmAction } from "./confirm-action";

// confirmAction stojí mezi účetní a nevratnou akcí: rozesláním upomínek,
// zaúčtováním plateb, smazáním faktury. Neměl test, přestože jeho selhání
// znamená buď akci bez potvrzení, nebo akci, kterou nejde potvrdit.

// jsdom neimplementuje nativní <dialog>; doplníme minimum, které modul volá.
function patchDialog() {
  const prototype = window.HTMLDialogElement?.prototype ?? HTMLElement.prototype;
  (prototype as unknown as { showModal: () => void }).showModal = function showModal(this: HTMLElement) {
    this.setAttribute("open", "");
  };
  (prototype as unknown as { close: () => void }).close = function close(this: HTMLElement) {
    this.removeAttribute("open");
  };
}
patchDialog();

const dialog = () => document.querySelector("dialog.confirm-dialog");
const button = (label: string) =>
  [...document.querySelectorAll("dialog.confirm-dialog button")].find(
    (element) => element.textContent === label,
  ) as HTMLButtonElement | undefined;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("confirmAction", () => {
  it("shows the title and description it was given", async () => {
    const pending = confirmAction({
      title: "Stornovat fakturu FV-2026-001?",
      description: "Faktura zůstane v archivu jako stornovaná.",
    });
    expect(dialog()?.textContent).toContain("Stornovat fakturu FV-2026-001?");
    expect(dialog()?.textContent).toContain("zůstane v archivu");
    button("Zrušit")?.click();
    await pending;
  });

  it("resolves true only when the confirming button is pressed", async () => {
    const pending = confirmAction({ title: "T", description: "D", confirmLabel: "Zaúčtovat" });
    button("Zaúčtovat")?.click();
    await expect(pending).resolves.toBe(true);
  });

  it("resolves false on cancel", async () => {
    const pending = confirmAction({ title: "T", description: "D" });
    button("Zrušit")?.click();
    await expect(pending).resolves.toBe(false);
  });

  it("treats Escape as a refusal, never as agreement", async () => {
    // Nejnebezpečnější možná chyba: zavření dialogu klávesou by nesmělo
    // znamenat souhlas s rozesláním e-mailů nebo zaúčtováním peněz.
    const pending = confirmAction({ title: "T", description: "D" });
    dialog()?.dispatchEvent(new Event("cancel", { cancelable: true }));
    await expect(pending).resolves.toBe(false);
  });

  it("treats a click on the backdrop as a refusal", async () => {
    const pending = confirmAction({ title: "T", description: "D" });
    const element = dialog() as HTMLElement;
    element.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    await expect(pending).resolves.toBe(false);
  });

  it("resolves exactly once, even if the user clicks twice", async () => {
    // Dvojklik na "Zaúčtovat" nesmí vést ke dvěma zaúčtováním.
    const pending = confirmAction({ title: "T", description: "D" });
    const confirm = button("Potvrdit");
    confirm?.click();
    confirm?.click();
    await expect(pending).resolves.toBe(true);
  });

  it("removes itself from the page afterwards", async () => {
    const pending = confirmAction({ title: "T", description: "D" });
    button("Zrušit")?.click();
    await pending;
    expect(dialog()).toBeNull();
  });

  it("starts focused on cancel, so a stray Enter does not confirm", async () => {
    const pending = confirmAction({ title: "T", description: "D" });
    expect(document.activeElement?.textContent).toBe("Zrušit");
    button("Zrušit")?.click();
    await pending;
  });

  it("is announced to screen readers with its own title and description", async () => {
    const pending = confirmAction({ title: "Nadpis", description: "Popis" });
    const element = dialog() as HTMLElement;
    const titleId = element.getAttribute("aria-labelledby");
    const descriptionId = element.getAttribute("aria-describedby");
    expect(element.querySelector(`#${titleId}`)?.textContent).toBe("Nadpis");
    expect(element.querySelector(`#${descriptionId}`)?.textContent).toBe("Popis");
    button("Zrušit")?.click();
    await pending;
  });

  it("uses the Czech labels it was given", async () => {
    const pending = confirmAction({
      title: "T", description: "D",
      confirmLabel: "Odeslat", cancelLabel: "Nechat být",
    });
    expect(button("Odeslat")).toBeTruthy();
    expect(button("Nechat být")).toBeTruthy();
    button("Nechat být")?.click();
    await pending;
  });
});
