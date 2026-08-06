export const MAX_PAYMENT_IMPORT_ROWS = 500;

export interface PaymentImportRow {
  external_id: string;
  booked_on: string;
  amount: number;
  currency: string;
  variable_symbol: string;
  counterparty_name?: string;
  counterparty_account?: string;
  note?: string;
}

function splitCsvRow(row: string, delimiter: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '"') {
      if (quoted && row[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("CSV obsahuje neuzavřené uvozovky.");
  values.push(value.trim());
  return values;
}

function normalizeHeader(value: string) {
  return value.trim().toLocaleLowerCase("cs").replaceAll("_", " ").replace(/\s+/g, " ");
}

function parseDate(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const czech = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (!czech) return "";
  return `${czech[3]}-${czech[2].padStart(2, "0")}-${czech[1].padStart(2, "0")}`;
}

function isRealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

function parseAmount(value: string) {
  const cleaned = value.replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  const decimal = comma >= 0 && dot >= 0
    ? comma > dot ? cleaned.replaceAll(".", "").replace(",", ".") : cleaned.replaceAll(",", "")
    : comma >= 0 ? cleaned.replace(",", ".") : cleaned;
  return Number(decimal);
}

export function validatePaymentRows(value: unknown): PaymentImportRow[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PAYMENT_IMPORT_ROWS) return null;
  const parsed: PaymentImportRow[] = [];
  const identifiers = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const externalId = typeof row.external_id === "string" ? row.external_id.trim() : "";
    const bookedOn = typeof row.booked_on === "string" ? row.booked_on.trim() : "";
    const amount = Number(row.amount);
    const currency = typeof row.currency === "string" ? row.currency.trim().toUpperCase() : "";
    const variableSymbol = typeof row.variable_symbol === "string" ? row.variable_symbol.trim() : "";
    const counterpartyName = typeof row.counterparty_name === "string" ? row.counterparty_name.trim() : "";
    const counterpartyAccount = typeof row.counterparty_account === "string" ? row.counterparty_account.trim() : "";
    const note = typeof row.note === "string" ? row.note.trim() : "";

    if (
      !externalId || externalId.length > 120 || identifiers.has(externalId) ||
      !isRealDate(bookedOn) || !Number.isFinite(amount) || amount <= 0 || amount > 999_999_999_999.99 ||
      !/^[A-Z]{3}$/.test(currency) || variableSymbol.length > 20 || !/^\d*$/.test(variableSymbol) ||
      counterpartyName.length > 200 || counterpartyAccount.length > 100 || note.length > 500
    ) return null;

    identifiers.add(externalId);
    parsed.push({
      external_id: externalId,
      booked_on: bookedOn,
      amount: Math.round(amount * 100) / 100,
      currency,
      variable_symbol: variableSymbol,
      counterparty_name: counterpartyName || undefined,
      counterparty_account: counterpartyAccount || undefined,
      note: note || undefined,
    });
  }
  return parsed;
}

export function parsePaymentCsv(text: string): PaymentImportRow[] {
  const clean = text.replace(/^\uFEFF/, "").trim();
  const lines = clean.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error("CSV neobsahuje žádné platby.");
  if (lines.length - 1 > MAX_PAYMENT_IMPORT_ROWS) throw new Error(`Jeden import může obsahovat nejvýše ${MAX_PAYMENT_IMPORT_ROWS} plateb.`);

  const delimiter = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = splitCsvRow(lines[0], delimiter).map(normalizeHeader);
  const column = (...names: string[]) => headers.findIndex(header => names.includes(header));
  const columns = {
    id: column("id transakce", "identifikátor transakce", "identifikator transakce", "transaction id", "external id"),
    date: column("datum", "datum zaúčtování", "datum zauctovani", "booked on", "date"),
    amount: column("částka", "castka", "amount"),
    currency: column("měna", "mena", "currency"),
    variable: column("variabilní symbol", "variabilni symbol", "vs", "variable symbol"),
    name: column("protistrana", "název protistrany", "nazev protistrany", "counterparty", "counterparty name"),
    account: column("účet protistrany", "ucet protistrany", "counterparty account", "iban"),
    note: column("poznámka", "poznamka", "zpráva", "zprava", "note", "message"),
  };
  if ([columns.id, columns.date, columns.amount, columns.currency].some(index => index < 0)) {
    throw new Error("CSV musí obsahovat ID transakce, datum, částku a měnu. Variabilní symbol je doporučený pro automatické spárování.");
  }

  const rows = lines.slice(1).map((line, index) => {
    const values = splitCsvRow(line, delimiter);
    const bookedOn = parseDate(values[columns.date] ?? "");
    const amount = parseAmount(values[columns.amount] ?? "");
    return {
      external_id: values[columns.id] ?? "",
      booked_on: bookedOn,
      amount,
      currency: (values[columns.currency] || "CZK").toUpperCase(),
      variable_symbol: columns.variable >= 0 ? (values[columns.variable] ?? "").replace(/\s/g, "") : "",
      counterparty_name: columns.name >= 0 ? values[columns.name] : undefined,
      counterparty_account: columns.account >= 0 ? values[columns.account] : undefined,
      note: columns.note >= 0 ? values[columns.note] : undefined,
      rowNumber: index + 2,
    };
  });
  const validated = validatePaymentRows(rows);
  if (!validated) throw new Error("CSV obsahuje neplatný nebo duplicitní řádek. Zkontrolujte ID, datum, kladnou částku, třípísmennou měnu a variabilní symbol.");
  return validated;
}
