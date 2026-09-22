// Kam se uzivatel vrati po prihlaseni. Hodnota jde z URL, takze ji urcuje
// kdokoli, kdo umi poslat odkaz -- bez validace je to otevreny redirect.
//
// Zaludnost: "//evil.example/x" prohlizec chape jako ABSOLUTNI URL (jen
// prevezme aktualni schema), presto to zacina lomitkem. Samotna kontrola
// na uvodni "/" tedy nestaci.
const MAX_LENGTH = 512;

export function safeReturnPath(raw: string | null | undefined, fallback = "/dashboard") {
  if (!raw) return fallback;

  let value = raw.trim();
  if (!value || value.length > MAX_LENGTH) return fallback;

  // Odkaz mohl projit jednim kolem enkodovani (api-client posila
  // encodeURIComponent). Dekoduje se jen jednou -- opakovane dekodovani je
  // samo o sobe zpusob, jak validaci obejit.
  try {
    value = decodeURIComponent(value);
  } catch {
    return fallback;
  }

  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  // Řídicí znaky a zpetne lomitko dokazou v nekterych prohlizecich zmenit
  // vyznam cesty; do navigace nepatri.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  // Prihlasovaci stranky by delaly smycku.
  if (/^\/(login|register|forgot-password|reset-password|mfa)(\/|\?|$)/.test(value)) return fallback;

  return value;
}
