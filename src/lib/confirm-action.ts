"use client";

type ConfirmActionOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export function confirmAction({ title, description, confirmLabel = "Potvrdit", cancelLabel = "Zrušit" }: ConfirmActionOptions) {
  return new Promise<boolean>((resolve) => {
    const dialog = document.createElement("dialog");
    const titleId = `confirm-title-${crypto.randomUUID()}`;
    const descriptionId = `confirm-description-${crypto.randomUUID()}`;
    dialog.className = "confirm-dialog";
    dialog.setAttribute("aria-labelledby", titleId);
    dialog.setAttribute("aria-describedby", descriptionId);

    const panel = document.createElement("div");
    const heading = document.createElement("h2");
    const text = document.createElement("p");
    const actions = document.createElement("div");
    const cancel = document.createElement("button");
    const confirm = document.createElement("button");
    heading.id = titleId;
    heading.textContent = title;
    text.id = descriptionId;
    text.textContent = description;
    cancel.type = "button";
    cancel.className = "btn secondary";
    cancel.textContent = cancelLabel;
    confirm.type = "button";
    confirm.className = "btn danger";
    confirm.textContent = confirmLabel;
    actions.className = "confirm-dialog-actions";
    actions.append(cancel, confirm);
    panel.append(heading, text, actions);
    dialog.append(panel);
    document.body.append(dialog);

    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) finish(false);
    });
    dialog.showModal();
    cancel.focus();
  });
}
