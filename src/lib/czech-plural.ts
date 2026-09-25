// 1 faktura, 2–4 faktury, 0 a 5+ faktur. Stačí na počty dokladů v reportu;
// obecné skloňování (desetinná čísla, 21, 22 …) se tu záměrně neřeší.
export function invoiceCountLabel(count: number) {
  const noun = count === 1 ? "faktura" : count >= 2 && count <= 4 ? "faktury" : "faktur";
  return `${count} ${noun}`;
}
