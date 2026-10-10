import type { ReminderStage } from "@/types/invoice";
import { paymentAccountFor } from "@/lib/bank-accounts";
import type { ReminderTemplateValues } from "@/lib/reminder-template";

export type ReminderEmailCompany = {
  name: string;
  ico?: string | null;
  dic?: string | null;
  registered_address?: string | null;
  operating_address?: string | null;
  phone?: string | null;
  email?: string | null;
  bank_account_czk?: string | null;
  bank_account_eur?: string | null;
  /** Další účty firmy (organization_bank_accounts) pro měny bez hlavního účtu. */
  bank_accounts?: { account: string; currency: string }[] | null;
  logo_path?: string | null;
};

// Logo v upomínce je logo firmy, která upomínku posílá (organizations.
// logo_path). Firma bez loga posílá upomínku bez loga -- nikdy s cizím.
export function reminderLogoUrl(logoPath: string | null | undefined, baseUrl: string | null | undefined) {
  if (!logoPath || !baseUrl) return null;
  try {
    return new URL(logoPath, baseUrl).toString();
  } catch {
    return null;
  }
}

type RenderReminderEmailParams = {
  company: ReminderEmailCompany;
  stage: ReminderStage;
  subject: string;
  message: string;
  values: ReminderTemplateValues;
  logoUrl?: string | null;
  replyTo?: string | null;
  // Zdroj obrázku QR platby: "cid:…" v odeslaném e-mailu (inline příloha),
  // "data:image/png;base64,…" v náhledu v aplikaci. Bez něj blok s QR není.
  qrSrc?: string | null;
  // Jen u částečně uhrazené faktury. QR zní na zbývající částku, takže ji
  // text musí ukázat taky -- vedle celé částky, nic se tiše nenahrazuje.
  payment?: { total: string; paid: string; remaining: string } | null;
};

const stagePresentation: Record<ReminderStage, { eyebrow: string; title: string; preheader: string; accent: string; soft: string }> = {
  before_due: {
    eyebrow: "PŘIPOMENUTÍ SPLATNOSTI",
    title: "Blíží se splatnost faktury",
    preheader: "Připomínáme blížící se termín splatnosti Vaší faktury.",
    accent: "#2f7650",
    soft: "#edf7f0",
  },
  on_due: {
    eyebrow: "SPLATNOST DNES",
    title: "Faktura je dnes splatná",
    preheader: "Dnes nastává termín splatnosti Vaší faktury.",
    accent: "#a66f20",
    soft: "#fff8e7",
  },
  overdue: {
    eyebrow: "FAKTURA PO SPLATNOSTI",
    title: "Připomenutí neuhrazené faktury",
    preheader: "Podle naší evidence je faktura stále neuhrazená.",
    accent: "#b84336",
    soft: "#fff0ee",
  },
  escalation: {
    eyebrow: "OPAKOVANÁ VÝZVA K ÚHRADĚ",
    title: "Faktura zůstává neuhrazená",
    preheader: "Prosíme o neodkladné vyřešení neuhrazené faktury.",
    accent: "#96352c",
    soft: "#fff0ee",
  },
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function safeLogoUrl(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized.startsWith("/")) return normalized;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

// Do e-mailu smí jen inline příloha nebo PNG vložené přímo, nikdy odkaz ven
// ani nic, co by vystoupilo z atributu src.
function safeQrSrc(value?: string | null) {
  if (!value) return null;
  return /^cid:[\w.-]+$/.test(value) || /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value) ? value : null;
}

function safeReplyAddress(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^\S+@\S+\.\S+$/.test(normalized) ? normalized : null;
}

function paragraphs(value: string) {
  return value
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(paragraph => `<p style="margin:0 0 18px;color:#35433a;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function detailRow(label: string, value: string, last = false) {
  return `<tr class="detail-row">
    <td class="detail-label" width="38%" style="width:38%;padding:13px 12px 13px 0;${last ? "" : "border-bottom:1px solid #e4e9e5;"}color:#6d776f;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(label)}</td>
    <td class="detail-value" width="62%" align="right" style="width:62%;padding:13px 0 13px 12px;${last ? "" : "border-bottom:1px solid #e4e9e5;"}color:#17221c;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:1.45;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(value)}</td>
  </tr>`;
}

function companyContactLines(company: ReminderEmailCompany) {
  return [
    company.email,
    company.phone,
    company.registered_address,
    company.ico ? `IČO ${company.ico}` : null,
    company.dic ? `DIČ ${company.dic}` : null,
  ].filter((value): value is string => Boolean(value?.trim()));
}

export function renderReminderEmail(params: RenderReminderEmailParams) {
  const presentation = stagePresentation[params.stage];
  const companyName = params.company.name.trim();
  // A missing company name used to silently fall back to "R. Hlavica
  // s.r.o." -- harmless while this is the only organization, but the moment
  // a second one exists (the planned move to a multi-tenant product), that
  // fallback would put OUR name on a debt-collection e-mail belonging to a
  // different company's customer. Failing loudly here delays one reminder
  // (retried next cron run, or visible in the manual-send error) instead of
  // ever sending an e-mail branded as the wrong company.
  if (!companyName) throw new Error("Chybí název firmy pro upomínkový e-mail.");
  const logoUrl = safeLogoUrl(params.logoUrl);
  const replyAddress = safeReplyAddress(params.replyTo) ?? safeReplyAddress(params.company.email);
  // Účet v měně faktury; nikdy korunový účet u faktury v jiné měně.
  const bankAccount = paymentAccountFor(params.values.currency, params.company, params.company.bank_accounts ?? []);
  const details = [
    ["Číslo faktury", params.values.invoice_number],
    ...(params.payment
      ? [
        ["Částka faktury", `${params.payment.total} ${params.values.currency}`],
        ["Uhrazeno", `${params.payment.paid} ${params.values.currency}`],
        ["Zbývá uhradit", `${params.payment.remaining} ${params.values.currency}`],
      ]
      : [["Částka k úhradě", `${params.values.amount} ${params.values.currency}`]]),
    ["Datum splatnosti", params.values.due_date],
    ["Variabilní symbol", params.values.variable_symbol || "—"],
    ...(bankAccount ? [["Bankovní účet", bankAccount]] : []),
  ];
  const detailRows = details.map(([label, value], index) => detailRow(label, value, index === details.length - 1)).join("");
  const replyHref = replyAddress
    ? `mailto:${replyAddress}?subject=${encodeURIComponent(`Faktura ${params.values.invoice_number}`)}`
    : null;
  // Same reasoning as the companyName guard above: when no logo image is
  // configured, the text fallback must show THIS company's real name, not a
  // hardcoded brand that only happens to be correct for a single tenant.
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="91" height="85" alt="${escapeHtml(companyName)}" style="display:block;width:91px;height:85px;border:0;outline:none;text-decoration:none;object-fit:contain;">`
    : `<div style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;line-height:1.3;">${escapeHtml(companyName)}</div>`;
  const cta = replyHref ? `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0;">
      <tr><td>
        <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${escapeHtml(replyHref)}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="12%" stroke="f" fillcolor="#17462f"><w:anchorlock xmlns:w="urn:schemas-microsoft-com:office:word"/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">Kontaktovat účetní oddělení</center></v:roundrect><![endif]-->
        <!--[if !mso]><!--><a href="${escapeHtml(replyHref)}" style="display:inline-block;padding:13px 20px;background:#17462f;border-radius:6px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:18px;text-decoration:none;">Kontaktovat účetní oddělení</a><!--<![endif]-->
      </td></tr>
    </table>` : "";
  const qrSrc = safeQrSrc(params.qrSrc);
  const qrBlock = qrSrc ? `
        <tr><td class="mobile-pad" style="padding:22px 42px 0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid #e4e9e5;border-radius:8px;border-collapse:separate;">
            <tr>
              <td class="qr-cell" width="176" style="width:176px;padding:16px;vertical-align:middle;"><img src="${qrSrc}" width="160" height="160" alt="QR platba" style="display:block;width:160px;height:160px;border:0;outline:none;"></td>
              <td class="qr-text" style="padding:16px 18px 16px 0;vertical-align:middle;">
                <p style="margin:0 0 6px;color:#17221c;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:1.35;">Zaplaťte QR kódem</p>
                <p style="margin:0;color:#5b665e;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;">Otevřete aplikaci své banky a zvolte platbu QR kódem. Účet, částka i variabilní symbol se vyplní samy.</p>
                <p style="margin:8px 0 0;color:#7a857d;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;">Čtete e-mail v telefonu? Podržte prst na kódu, uložte obrázek a v aplikaci banky ho načtěte z galerie.</p>
              </td>
            </tr>
          </table>
        </td></tr>` : "";
  const contactLines = companyContactLines(params.company);
  const footer = contactLines.map(escapeHtml).join(" &nbsp;·&nbsp; ");

  const html = `<!doctype html>
<html lang="cs" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(params.subject)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    @media only screen and (max-width:680px){
      .email-shell{width:100%!important;max-width:100%!important}
      .mobile-pad{padding-left:22px!important;padding-right:22px!important}
      .email-title{font-size:25px!important}
      .detail-box-pad{padding:18px!important}
    }
    @media only screen and (max-width:480px){
      .detail-table{table-layout:auto!important}
      .detail-row{display:block!important;width:100%!important}
      .detail-label,.detail-value{display:block!important;width:100%!important;max-width:100%!important;text-align:left!important;box-sizing:border-box!important}
      .detail-label{padding:12px 0 2px!important;border-bottom:0!important}
      .detail-value{padding:0 0 12px!important}
      .qr-cell,.qr-text{display:block!important;width:auto!important}
      .qr-text{padding:0 16px 16px!important}
      .sign-cell,.cta-cell{display:block!important;width:100%!important;padding-left:0!important;text-align:left!important}
      .cta-cell{padding-top:18px!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f2f4f1;word-spacing:normal;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(presentation.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f2f4f1">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" class="email-shell" width="640" cellspacing="0" cellpadding="0" border="0" style="width:640px;max-width:640px;background:#ffffff;border:1px solid #dfe5e0;border-radius:12px;overflow:hidden;">
        <tr><td class="mobile-pad" bgcolor="#17462f" style="padding:18px 34px;background:#17462f;">${logo}</td></tr>
        <tr><td class="mobile-pad" style="padding:38px 42px 8px;">
          <div style="margin-bottom:10px;color:${presentation.accent};font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.3px;">${presentation.eyebrow}</div>
          <h1 class="email-title" style="margin:0 0 24px;color:#17221c;font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:700;line-height:1.2;letter-spacing:-0.5px;">${escapeHtml(presentation.title)}</h1>
          ${paragraphs(params.message)}
        </td></tr>
        <tr><td class="mobile-pad" style="padding:0 42px;">
          <table role="presentation" class="detail-box" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${presentation.soft}" style="width:100%;max-width:100%;background:${presentation.soft};border:1px solid ${presentation.accent}33;border-radius:8px;border-collapse:separate;">
            <tr><td class="detail-box-pad" style="padding:24px 26px;">
              <table role="presentation" class="detail-table" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:100%;table-layout:fixed;">
                <tr><td colspan="2" style="padding:0 0 9px;color:${presentation.accent};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.8px;">ÚDAJE K PLATBĚ</td></tr>
                ${detailRows}
              </table>
            </td></tr>
          </table>
        </td></tr>${qrBlock}
        <tr><td class="mobile-pad" style="padding:26px 42px 34px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
            <tr>
              <td class="sign-cell" valign="middle" style="vertical-align:middle;">
                <p style="margin:0;color:#35433a;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;">S pozdravem<br><strong>${escapeHtml(companyName)}</strong></p>
              </td>${cta ? `
              <td class="cta-cell" align="right" valign="middle" style="vertical-align:middle;padding-left:16px;">${cta}</td>` : ""}
            </tr>
          </table>
        </td></tr>
        <tr><td class="mobile-pad" bgcolor="#f7f8f6" style="padding:20px 42px;background:#f7f8f6;border-top:1px solid #e5e9e5;">
          <p style="margin:0;color:#7a857d;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.7;text-align:center;">${footer}</p>
          <p style="margin:8px 0 0;color:#929a94;font-family:Arial,Helvetica,sans-serif;font-size:9px;line-height:1.5;text-align:center;">Tato zpráva byla odeslána automaticky k evidované faktuře. Pokud jste již platbu provedli, považujte ji za bezpředmětnou.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textDetails = details.map(([label, value]) => `${label}: ${value}`).join("\n");
  const textContact = contactLines.join(" · ");
  const text = `${params.message.trim()}\n\nÚDAJE K PLATBĚ\n${textDetails}${qrSrc ? "\n\nQR kód pro platbu najdete v HTML verzi e-mailu. Načtěte ho v aplikaci své banky (platba QR kódem)." : ""}\n\nS pozdravem\n${companyName}${textContact ? `\n${textContact}` : ""}`;

  return { subject: params.subject, html, text };
}
