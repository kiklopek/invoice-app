import { API_KEY_SCOPE_LABELS } from "./api-key-policy";
import { INVOICE_CURRENCIES } from "./invoice-currency";
import { INVOICE_EVENT_TYPES } from "@/types/invoice";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const uuid = { type: "string", format: "uuid" };
const date = { type: "string", format: "date" };
const timestamp = { type: "string", format: "date-time" };
const nullableText = { type: ["string", "null"] };
const nullableTimestamp = { type: ["string", "null"], format: "date-time" };
const statuses = ["pending", "overdue", "paid", "cancelled"];
const json = (schema: object) => ({ "application/json": { schema } });
const responseHeaders = {
  "X-Request-Id": {
    description: "Identifikátor pro dohledání požadavku v provozní historii.",
    schema: { type: "string" },
  },
  "X-RateLimit-Limit": {
    description:
      "Limit autentizovaného klíče za okno. Hlavička je přítomná po úspěšném ověření klíče.",
    schema: { type: "integer" },
  },
  "X-RateLimit-Remaining": {
    description: "Zbývající počet požadavků v okně.",
    schema: { type: "integer" },
  },
  "X-RateLimit-Reset": {
    description: "Konec aktuálního okna jako ISO timestamp.",
    schema: timestamp,
  },
};
const response = (description: string, schema: object) => ({
  description,
  content: json(schema),
  headers: responseHeaders,
});
const body = (schema: object) => ({ required: true, content: json(schema) });
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const envelope = (name: string, schema: string) =>
  object({ [name]: ref(schema) }, [name]);
const idParameter = {
  name: "id",
  in: "path",
  required: true,
  description: "Identifikátor objektu ve firmě API klíče.",
  schema: uuid,
};
const pagination = [
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  },
  {
    name: "cursor",
    in: "query",
    description:
      "Neprůhledný kurzor vrácený předchozí odpovědí. Při pokračování zachovejte stejné filtry.",
    schema: { type: "string", maxLength: 256 },
  },
];
const invoiceFilter = { name: "invoice_id", in: "query", schema: uuid };
const idempotency = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  description:
    "Stabilní identifikátor jedné operace. Při opakování použijte stejný klíč i obsah. Je oddělený podle firmy a typu operace.",
  schema: {
    type: "string",
    minLength: 1,
    maxLength: 100,
    pattern: "^[A-Za-z0-9_.:-]+$",
  },
};
const errors = {
  "400": response(
    "Neplatný požadavek nebo chybějící Idempotency-Key.",
    ref("Error"),
  ),
  "401": response(
    "Chybějící, neplatný, zrušený nebo expirovaný klíč, případně neaktivní oprávnění jeho autora.",
    ref("Error"),
  ),
  "403": response("API klíč nemá požadované oprávnění.", ref("Error")),
  "429": {
    ...response("Překročený limit požadavků klíče.", ref("Error")),
    headers: {
      ...responseHeaders,
      "Retry-After": {
        schema: { type: "integer", minimum: 1 },
        description: "Počet sekund do dalšího pokusu.",
      },
    },
  },
  "503": response(
    "Dočasná nedostupnost služby. U zápisů zachovejte Idempotency-Key.",
    ref("Error"),
  ),
};
const writeErrors = {
  "409": response(
    "Konflikt obsahu opakované operace, stavu objektu nebo existujícího zákazníka.",
    ref("Error"),
  ),
  "413": response("JSON tělo překročilo 64 KiB.", ref("Error")),
  "415": response(
    "Požadavek musí mít Content-Type application/json.",
    ref("Error"),
  ),
};
const notFound = {
  "404": response("Objekt v této firmě není dostupný.", ref("Error")),
};
function operation(
  scope: keyof typeof API_KEY_SCOPE_LABELS,
  operationId: string,
  summary: string,
  options: Record<string, unknown>,
) {
  return { operationId, summary, "x-required-scope": scope, ...options };
}
const page = (item: string) =>
  object(
    {
      data: { type: "array", items: ref(item) },
      has_more: { type: "boolean" },
      next_cursor: nullableText,
    },
    ["data", "has_more", "next_cursor"],
  );

export const publicApiOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Splatno Public API",
    version: "1.0.0",
    description:
      "Serverové integrace faktur, zákazníků, plateb, upomínek a reportů. Klíč je omezený na jednu firmu a vybraná oprávnění. Částky v odpovědích jsou desetinné řetězce se dvěma místy. JSON těla mají limit 64 KiB. Výchozí limit klíče je 120 požadavků za 60 sekund.",
  },
  servers: [
    {
      url: "https://www.splatno.com/api/v1",
      description: "Produkční URL po nasazení API migrací a aplikace.",
    },
  ],
  security: [{ ApiKey: [] }],
  "x-permissions": API_KEY_SCOPE_LABELS,
  paths: {
    "/openapi": {
      get: {
        operationId: "getOpenApi",
        summary: "Strojově čitelná smlouva API",
        security: [],
        responses: {
          "200": response("OpenAPI dokument.", {
            type: "object",
            additionalProperties: true,
          }),
        },
      },
    },
    "/invoices": {
      get: operation("invoices:read", "listInvoices", "Seznam faktur", {
        parameters: [
          ...pagination,
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: statuses },
          },
          {
            name: "variable_symbol",
            in: "query",
            schema: { type: "string", pattern: "^[0-9]{1,10}$" },
          },
        ],
        responses: {
          "200": response(
            "Faktury vzestupně podle created_at a id.",
            page("Invoice"),
          ),
          ...errors,
        },
      }),
      post: operation(
        "invoices:write",
        "createInvoice",
        "Vystavit fakturu z cen včetně DPH",
        {
          description:
            "Číslo FV-RRRR-NNNNNN přiděluje Splatno. Součet musí odpovídat expected_total. Pro paid_amount větší než nula jsou navíc nutné payments:write a payment_confirmed=true. Faktura se neodesílá automaticky. Idempotency-Key lze nahradit UUID v request_id. Při uvedení obou musí být shodné. Opakování zůstává svázané s původním obsahem i po rotaci klíče ve stejné firmě.",
          parameters: [{ ...idempotency, required: false }],
          requestBody: body(ref("InvoiceCreate")),
          responses: {
            "201": response(
              "Nově vystavená faktura.",
              ref("InvoiceWriteResult"),
            ),
            "200": response(
              "Dříve vystavená faktura stejné operace, replayed=true.",
              ref("InvoiceWriteResult"),
            ),
            "402": response(
              "Vyčerpaný limit nebo neaktivní předplatné.",
              ref("Error"),
            ),
            "422": response(
              "Součet položek se neshoduje s expected_total. code=total_mismatch, computed obsahuje vypočtený součet.",
              ref("Error"),
            ),
            ...errors,
            ...writeErrors,
          },
        },
      ),
    },
    "/invoices/{id}": {
      get: operation(
        "invoices:read",
        "getInvoice",
        "Detail a aktuální úhrada faktury",
        {
          parameters: [idParameter],
          responses: {
            "200": response("Faktura.", envelope("invoice", "Invoice")),
            ...errors,
            ...notFound,
          },
        },
      ),
    },
    "/invoices/{id}/pdf": {
      get: operation("invoices:read", "getInvoicePdf", "Stáhnout PDF faktury", {
        parameters: [idParameter],
        responses: {
          "200": {
            description: "PDF dokument.",
            content: {
              "application/pdf": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          ...errors,
          ...notFound,
        },
      }),
    },
    "/invoices/{id}/send": {
      post: operation(
        "invoices:send",
        "sendInvoice",
        "Odeslat vystavenou fakturu odběrateli",
        {
          description:
            "Integrace musí před voláním získat potvrzení odeslání. Používá e-mail uložený na faktuře a ochranu prvního odeslání. Po přijetí prvního odeslání poskytovatelem vrací already_sent=true i s novým klíčem operace. Přijetí neznamená doručení do schránky.",
          parameters: [idParameter, idempotency],
          requestBody: body(
            object({ recipient_confirmed: { type: "boolean", const: true } }, [
              "recipient_confirmed",
            ]),
          ),
          responses: {
            "200": response(
              "Poskytovatel přijal zprávu nebo byla přijata již dříve.",
              object(
                {
                  ok: { type: "boolean", const: true },
                  already_sent: { type: "boolean" },
                },
                ["ok"],
              ),
            ),
            "502": response(
              "Odeslání nebo vytvoření přílohy selhalo. Ověřte stav a opakujte stejnou operaci.",
              ref("Error"),
            ),
            ...errors,
            ...writeErrors,
            ...notFound,
          },
        },
      ),
    },
    "/invoices/{id}/reminders": {
      patch: operation(
        "reminders:write",
        "setInvoiceReminders",
        "Pozastavit nebo obnovit upomínání faktury",
        {
          description:
            "Opakované nastavení stejné hodnoty je bezpečné. Změna zachovává úhrady a stav faktury. Při právě odesílané upomínce může vrátit konflikt reminder_in_flight.",
          parameters: [idParameter],
          requestBody: body(
            object({ paused: { type: "boolean" } }, ["paused"]),
          ),
          responses: {
            "200": response(
              "Aktuální stav upomínání.",
              ref("ReminderPreferenceResult"),
            ),
            ...errors,
            ...writeErrors,
            ...notFound,
          },
        },
      ),
    },
    "/customers": {
      get: operation("customers:read", "listCustomers", "Seznam zákazníků", {
        parameters: pagination,
        responses: {
          "200": response(
            "Zákazníci vzestupně podle created_at a id.",
            page("Customer"),
          ),
          ...errors,
        },
      }),
      post: operation(
        "customers:write",
        "createCustomer",
        "Založit zákazníka",
        {
          parameters: [idempotency],
          requestBody: body(ref("CustomerCreate")),
          responses: {
            "201": response("Nový zákazník.", ref("CustomerWriteResult")),
            "200": response(
              "Výsledek již provedené operace, replayed=true.",
              ref("CustomerWriteResult"),
            ),
            ...errors,
            ...writeErrors,
          },
        },
      ),
    },
    "/customers/{id}": {
      get: operation("customers:read", "getCustomer", "Detail zákazníka", {
        parameters: [idParameter],
        responses: {
          "200": response("Zákazník.", envelope("customer", "Customer")),
          ...errors,
          ...notFound,
        },
      }),
      patch: operation(
        "customers:write",
        "updateCustomerContact",
        "Aktualizovat e-mail nebo telefon zákazníka",
        {
          description:
            "Alespoň jedno pole je povinné. E-mail se promítne i do navázaných faktur podle společné logiky Splatna. updated_invoice_count uvádí počet upravených faktur. Právní identitu a adresu zákazníka tato operace nemění.",
          parameters: [idParameter],
          requestBody: body({
            ...object(
              {
                email: {
                  type: "string",
                  format: "email",
                  maxLength: 254,
                  minLength: 1,
                },
                phone: { type: ["string", "null"], maxLength: 40 },
              },
              [],
            ),
            minProperties: 1,
          }),
          responses: {
            "200": response(
              "Aktualizovaný kontakt.",
              object(
                {
                  customer: ref("Customer"),
                  updated_invoice_count: { type: "integer", minimum: 0 },
                },
                ["customer", "updated_invoice_count"],
              ),
            ),
            ...errors,
            ...writeErrors,
            ...notFound,
          },
        },
      ),
    },
    "/company": {
      get: operation(
        "company:read",
        "getCompany",
        "Údaje firmy a dostupné bankovní účty",
        {
          responses: {
            "200": response(
              "Firma, ke které patří API klíč.",
              envelope("company", "Company"),
            ),
            ...errors,
            ...notFound,
          },
        },
      ),
    },
    "/payments": {
      get: operation(
        "payments:read",
        "listPayments",
        "Seznam bankovních plateb",
        {
          description:
            "invoice_id zahrnuje přímou vazbu i potvrzené alokace mezi fakturami. allocations uvádí rozdělení částky na jednotlivé faktury. Pro aktuální celkovou úhradu faktury použijte její detail.",
          parameters: [...pagination, invoiceFilter],
          responses: {
            "200": response("Bankovní platby.", page("Payment")),
            ...errors,
          },
        },
      ),
    },
    "/reminders": {
      get: operation(
        "reminders:read",
        "listReminders",
        "Historie upomínek a jejich doručení",
        {
          parameters: [...pagination, invoiceFilter],
          responses: {
            "200": response("Záznamy upomínek.", page("Reminder")),
            ...errors,
          },
        },
      ),
    },
    "/events": {
      get: operation(
        "events:read",
        "listInvoiceEvents",
        "Průběžně načítat změny faktur",
        {
          description:
            "Polling událostí vzestupně podle created_at a id. Ukládejte next_cursor i při has_more=false. Prázdná stránka zachová vstupní kurzor. Po vyčerpání stránek počkejte a pokračujte stejným kurzorem. Události zpracovávejte s deduplikací podle id, aktuální stav načtěte z detailu faktury.",
          parameters: [
            ...pagination,
            invoiceFilter,
            {
              name: "type",
              in: "query",
              description: "Typ bez prefixu invoice., např. paid.",
              schema: { type: "string", enum: INVOICE_EVENT_TYPES },
            },
          ],
          responses: {
            "200": response("Události faktur.", page("InvoiceEvent")),
            ...errors,
          },
        },
      ),
    },
    "/reports": {
      get: operation(
        "reports:read",
        "getInvoiceReport",
        "Souhrn faktur za období a měnu",
        {
          parameters: [
            { name: "from", in: "query", required: true, schema: date },
            { name: "to", in: "query", required: true, schema: date },
            {
              name: "date_basis",
              in: "query",
              schema: {
                type: "string",
                enum: ["issue_date", "due_date", "paid_at"],
                default: "issue_date",
              },
            },
            {
              name: "currency",
              in: "query",
              schema: { type: "string", pattern: "^[A-Z]{3}$", default: "CZK" },
            },
            {
              name: "status",
              in: "query",
              schema: { type: "string", enum: statuses },
            },
            {
              name: "customer",
              in: "query",
              description: "Filtr podle názvu zákazníka.",
              schema: { type: "string", maxLength: 200 },
            },
          ],
          responses: {
            "200": response(
              "Souhrn jedné měny. from musí být nejvýše to.",
              envelope("report", "Report"),
            ),
            ...errors,
          },
        },
      ),
    },
  },
  components: {
    securitySchemes: {
      ApiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "spl_<secret>",
        description:
          "Klíč vytvořený administrátorem firmy v Nastavení. Posílejte jej pouze ze serveru přes HTTPS.",
      },
    },
    schemas: {
      Money: {
        type: "string",
        pattern: "^-?[0-9]+\\.[0-9]{2}$",
        examples: ["18400.00"],
      },
      MoneyInput: {
        oneOf: [
          { type: "string", pattern: "^[0-9]{1,12}(\\.[0-9]{1,2})?$" },
          {
            type: "number",
            minimum: 0,
            maximum: 999999999999.99,
            multipleOf: 0.01,
          },
        ],
        description:
          "Desetinná hodnota s nejvýše dvěma místy. Doporučený formát je řetězec s tečkou.",
      },
      CustomerCreate: object(
        {
          name: { type: "string", minLength: 1, maxLength: 200 },
          address: { type: "string", minLength: 1, maxLength: 500 },
          email: {
            type: "string",
            maxLength: 254,
            description: "Platný e-mail nebo prázdný řetězec.",
          },
          ico: { type: "string", pattern: "^([0-9]{8})?$" },
          dic: { type: "string", maxLength: 24 },
        },
        ["name", "address"],
      ),
      Customer: object(
        {
          id: uuid,
          name: { type: "string" },
          address: nullableText,
          email: nullableText,
          ico: nullableText,
          dic: nullableText,
          phone: nullableText,
          created_at: timestamp,
          updated_at: timestamp,
        },
        [
          "id",
          "name",
          "address",
          "email",
          "ico",
          "dic",
          "phone",
          "created_at",
          "updated_at",
        ],
      ),
      InvoiceCustomer: object(
        {
          name: { type: "string" },
          address: nullableText,
          email: nullableText,
          ico: nullableText,
          dic: nullableText,
        },
        ["name", "address", "email", "ico", "dic"],
      ),
      InvoiceCreate: object(
        {
          request_id: {
            ...uuid,
            description:
              "Volitelná náhrada Idempotency-Key. Při přítomnosti obou musí být shodné.",
          },
          variable_symbol: { type: "string", pattern: "^([0-9]{1,10})?$" },
          issue_date: date,
          due_date: date,
          tax_date: { ...date, description: "Výchozí hodnota je issue_date." },
          currency: {
            type: "string",
            enum: INVOICE_CURRENCIES,
            default: "CZK",
          },
          payment_method: {
            type: "string",
            enum: ["bank", "cash"],
            default: "bank",
          },
          paid_amount: { ...ref("MoneyInput"), default: 0 },
          payment_confirmed: {
            type: "boolean",
            description:
              "Pro kladnou počáteční úhradu musí být true a klíč musí mít payments:write.",
          },
          customer: ref("CustomerCreate"),
          items: {
            type: "array",
            minItems: 1,
            maxItems: 200,
            items: ref("InvoiceItemCreate"),
          },
          expected_total: {
            ...ref("MoneyInput"),
            description:
              "Kladný očekávaný součet, který musí odpovídat vypočtené faktuře.",
          },
          public_note: { type: "string", maxLength: 2000 },
          internal_note: { type: "string", maxLength: 5000 },
        },
        ["issue_date", "due_date", "customer", "items", "expected_total"],
      ),
      InvoiceItemCreate: object(
        {
          description: { type: "string", minLength: 1, maxLength: 500 },
          quantity: {
            oneOf: [
              { type: "string", pattern: "^[0-9]{1,12}(\\.[0-9]{1,6})?$" },
              {
                type: "number",
                exclusiveMinimum: 0,
                maximum: 1000000,
                multipleOf: 0.000001,
              },
            ],
            description:
              "Kladné množství nejvýše 1000000, až šest desetinných míst.",
          },
          unit: { type: "string", minLength: 1, maxLength: 20 },
          unit_price_gross: ref("MoneyInput"),
          vat_rate: {
            type: ["number", "null"],
            minimum: 0,
            maximum: 100,
            multipleOf: 0.01,
            description:
              "null znamená nepodléhá DPH. Výpočet probíhá shora za skupinu sazby.",
          },
        },
        ["description", "quantity", "unit", "unit_price_gross", "vat_rate"],
      ),
      InvoiceItem: object(
        {
          description: { type: "string" },
          quantity: { type: "string" },
          unit: { type: "string" },
          unit_price: { type: "string" },
          price_mode: { type: "string", enum: ["net", "gross"] },
          vat_rate: { type: ["number", "null"] },
          net: ref("Money"),
          tax: ref("Money"),
          gross: ref("Money"),
        },
        [
          "description",
          "quantity",
          "unit",
          "unit_price",
          "price_mode",
          "vat_rate",
          "net",
          "tax",
          "gross",
        ],
      ),
      VatBreakdown: object(
        {
          rate: { type: ["number", "null"] },
          net: ref("Money"),
          tax: ref("Money"),
          gross: ref("Money"),
        },
        ["rate", "net", "tax", "gross"],
      ),
      Invoice: object(
        {
          id: uuid,
          invoice_number: { type: "string" },
          variable_symbol: nullableText,
          amount: ref("Money"),
          amount_without_vat: ref("Money"),
          paid_amount: ref("Money"),
          remaining_amount: ref("Money"),
          currency: { type: "string" },
          status: { type: "string", enum: statuses },
          issue_date: date,
          due_date: date,
          paid_at: nullableTimestamp,
          created_at: timestamp,
          updated_at: timestamp,
          reminders_paused: { type: "boolean" },
          customer: ref("InvoiceCustomer"),
          tax_date: date,
          payment_method: { type: "string", enum: ["bank", "cash"] },
          public_note: { type: "string" },
          items: { type: "array", items: ref("InvoiceItem") },
          vat_breakdown: { type: "array", items: ref("VatBreakdown") },
        },
        [
          "id",
          "invoice_number",
          "variable_symbol",
          "amount",
          "amount_without_vat",
          "paid_amount",
          "remaining_amount",
          "currency",
          "status",
          "issue_date",
          "due_date",
          "paid_at",
          "created_at",
          "updated_at",
          "reminders_paused",
          "customer",
        ],
      ),
      InvoiceWriteResult: object(
        { invoice: ref("Invoice"), replayed: { type: "boolean" } },
        ["invoice", "replayed"],
      ),
      CustomerWriteResult: object(
        { customer: ref("Customer"), replayed: { type: "boolean" } },
        ["customer", "replayed"],
      ),
      ReminderPreferenceResult: object(
        {
          reminders: object(
            {
              invoice_id: uuid,
              paused: { type: "boolean" },
              next_reminder_at: nullableText,
              updated_at: timestamp,
            },
            ["invoice_id", "paused", "next_reminder_at", "updated_at"],
          ),
        },
        ["reminders"],
      ),
      Payment: object(
        {
          id: uuid,
          amount: ref("Money"),
          currency: { type: "string" },
          booked_on: date,
          variable_symbol: nullableText,
          invoice_id: { type: ["string", "null"], format: "uuid" },
          match_status: { type: "string" },
          matched_at: nullableTimestamp,
          created_at: timestamp,
          allocations: {
            type: "array",
            items: object({ invoice_id: uuid, amount: ref("Money") }, ["invoice_id", "amount"]),
          },
        },
        [
          "id",
          "amount",
          "currency",
          "booked_on",
          "variable_symbol",
          "invoice_id",
          "match_status",
          "matched_at",
          "created_at",
          "allocations",
        ],
      ),
      Reminder: object(
        {
          id: uuid,
          invoice_id: uuid,
          stage: {
            type: "string",
            enum: ["before_due", "on_due", "overdue", "escalation"],
          },
          status: { type: "string" },
          scheduled_for: date,
          sent_at: nullableTimestamp,
          delivery_status: nullableText,
          delivered_at: nullableTimestamp,
          attempt_count: { type: "integer", minimum: 0 },
          created_at: timestamp,
          updated_at: timestamp,
        },
        [
          "id",
          "invoice_id",
          "stage",
          "status",
          "scheduled_for",
          "sent_at",
          "delivery_status",
          "delivered_at",
          "attempt_count",
          "created_at",
          "updated_at",
        ],
      ),
      InvoiceEvent: object(
        {
          id: uuid,
          type: {
            type: "string",
            enum: INVOICE_EVENT_TYPES.map((type) => `invoice.${type}`),
          },
          invoice_id: uuid,
          created_at: timestamp,
        },
        ["id", "type", "invoice_id", "created_at"],
      ),
      Company: object(
        {
          id: uuid,
          name: { type: "string" },
          ico: nullableText,
          dic: nullableText,
          registered_address: nullableText,
          email: nullableText,
          vat_payer: { type: ["boolean", "null"] },
          bank_account_czk: nullableText,
          bank_account_eur: nullableText,
          bank_accounts: {
            type: "array",
            items: object(
              { account: { type: "string" }, currency: { type: "string" } },
              ["account", "currency"],
            ),
          },
        },
        [
          "id",
          "name",
          "ico",
          "dic",
          "registered_address",
          "email",
          "vat_payer",
          "bank_account_czk",
          "bank_account_eur",
          "bank_accounts",
        ],
      ),
      Report: object(
        {
          currency: { type: "string" },
          from: date,
          to: date,
          date_basis: {
            type: "string",
            enum: ["issue_date", "due_date", "paid_at"],
          },
          as_of_date: date,
          invoice_count: { type: "integer", minimum: 0 },
          total: ref("Money"),
          paid: ref("Money"),
          overdue: ref("Money"),
          open: ref("Money"),
          paid_rate: { type: "number" },
        },
        [
          "currency",
          "from",
          "to",
          "date_basis",
          "as_of_date",
          "invoice_count",
          "total",
          "paid",
          "overdue",
          "open",
          "paid_rate",
        ],
      ),
      Error: {
        type: "object",
        required: ["error", "code", "request_id"],
        properties: {
          error: { type: "string" },
          code: { type: "string" },
          request_id: { type: "string" },
          computed: {
            type: "number",
            description: "Vypočtená částka u chyby total_mismatch.",
          },
        },
        additionalProperties: true,
      },
    },
  },
};
