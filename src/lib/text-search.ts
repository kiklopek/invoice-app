/** Shared with the database search helpers in comprehensive_search.sql. */
export function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function compactSearchText(value: string): string {
  return value.replace(/[\s.+_\/()\-]/g, "");
}

export function searchFields(values: Array<string | null | undefined>) {
  return values.map((value) => {
    const normalized = normalizeSearchText(value);
    return { normalized, compact: compactSearchText(normalized) };
  });
}

/** Every word must match some field; their order and field do not matter. */
export function createTextMatcher(query: string) {
  const normalized = normalizeSearchText(query);
  const terms = normalized ? normalized.split(" ").map((term) => ({ term, compact: compactSearchText(term) })) : [];
  return (fields: ReturnType<typeof searchFields>) => terms.every(({ term, compact }) =>
    fields.some((field) => field.normalized.includes(term) || (compact.length >= 2 && field.compact.includes(compact))),
  );
}
