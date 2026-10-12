// Otevírací okna (menu pod třemi tečkami, nápovědy, našeptávače) se nesmí
// otevřít mimo obrazovku. Okno se změří v základní poloze a:
// - vodorovně se posune dovnitř (širší než obrazovka začne u levého okraje),
// - svisle se otevře nahoru, když se dolů nevejde a nahoře místo je
//   (a naopak u okna, které se otvírá nahoru).
// Čistá funkce; v prohlížeči ji používá src/components/popup-fitter.tsx.

export const POPUP_MARGIN = 12;

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export type PopupFit = { shiftX: number; placement: "above" | "below" | null };

export function fitPopup(params: {
  popup: Rect;
  anchor: Rect;
  viewport: { width: number; height: number };
  margin?: number;
}): PopupFit {
  const { popup, anchor, viewport } = params;
  const margin = params.margin ?? POPUP_MARGIN;

  let shiftX = 0;
  if (popup.right > viewport.width - margin) shiftX = viewport.width - margin - popup.right;
  if (popup.left + shiftX < margin) shiftX = margin - popup.left;

  const opensBelow = popup.top >= anchor.top;
  const spaceAbove = anchor.top - margin;
  const spaceBelow = viewport.height - margin - anchor.bottom;
  let placement: PopupFit["placement"] = null;
  if (opensBelow && popup.bottom > viewport.height - margin && spaceAbove >= popup.height && spaceAbove > spaceBelow) {
    placement = "above";
  } else if (!opensBelow && popup.top < margin && spaceBelow >= popup.height) {
    placement = "below";
  }
  return { shiftX: Math.round(shiftX), placement };
}
