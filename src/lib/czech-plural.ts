// Tvar podstatného jména podle počtu: 1 platba, 2–4 platby, 0 a 5+ plateb.
// Obecné skloňování (desetinná čísla, 21, 22 …) se tu záměrně neřeší --
// stačí na počty dokladů a plateb.
export function czechPlural(count: number, forms: readonly [one: string, few: string, many: string]) {
  return count === 1 ? forms[0] : count >= 2 && count <= 4 ? forms[1] : forms[2];
}

export function countLabel(count: number, forms: readonly [one: string, few: string, many: string]) {
  return `${count} ${czechPlural(count, forms)}`;
}

export function invoiceCountLabel(count: number) {
  return countLabel(count, ["faktura", "faktury", "faktur"]);
}
