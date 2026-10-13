// 1 faktura, 2–4 faktury, 0 a 5+ faktur. Stačí na počty dokladů v reportu;
// obecné skloňování (desetinná čísla, 21, 22 …) se tu záměrně neřeší.
export function invoiceCountLabel(count: number) {
  const noun = count === 1 ? "faktura" : count >= 2 && count <= 4 ? "faktury" : "faktur";
  return `${count} ${noun}`;
}

// Obecné skloňování pro celá nezáporná čísla: 1 partner, 2–4 partneři, 0 a 5+ partnerů.
export function plural(count: number, one: string, few: string, many: string) {
  const noun = count === 1 ? one : count >= 2 && count <= 4 ? few : many;
  return `${count} ${noun}`;
}
