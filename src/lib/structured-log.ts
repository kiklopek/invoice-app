import "server-only";

type LogValue = string | number | boolean | null | undefined;
type LogContext = Record<string, LogValue>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function clean(context: LogContext) {
  return Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
}

// Jedna a tatáž žádost musí dostat jedno a totéž id, i když se na něj zeptá
// víckrát -- jednou apiError() pro odpověď uživateli a jednou logError() pro
// zápis na server. Bez toho by si uživatel opsal číslo, které v logu není.
//
// Na Vercelu id nese hlavička x-vercel-id, takže je stabilní samo. Lokálně
// a při testech žádná taková hlavička není a crypto.randomUUID() by vrátilo
// pokaždé jinou hodnotu -- proto se vygenerované id drží u konkrétní žádosti.
// WeakMap nechá objekt žádosti normálně uklidit, jakmile doslouží.
const generatedIds = new WeakMap<Request, string>();

export function requestId(request: Request) {
  const fromPlatform = request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id");
  if (fromPlatform) return fromPlatform;
  const existing = generatedIds.get(request);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  generatedIds.set(request, generated);
  return generated;
}

// Kontext se rozbaluje PŘED vyhrazenými poli, ne za nimi. Volající, který
// omylem pošle v kontextu klíč "message" nebo "error", by jinak tiše přepsal
// popis chyby a v logu by zbyla nesouvisející věta -- přesně to se stalo
// v OCR routě, kde se do kontextu předával text výjimky.
export function logInfo(message: string, context: LogContext = {}) {
  console.log(JSON.stringify({ ...clean(context), level: "info", message, timestamp: new Date().toISOString() }));
}

export function logError(message: string, error: unknown, context: LogContext = {}) {
  console.error(JSON.stringify({
    ...clean(context),
    level: "error",
    message,
    error: errorMessage(error),
    timestamp: new Date().toISOString(),
  }));
}
