import type { ReminderStage } from "@/types/invoice";
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
};

type RenderReminderEmailParams = {
  company: ReminderEmailCompany;
  stage: ReminderStage;
  subject: string;
  message: string;
  values: ReminderTemplateValues;
  logoUrl?: string | null;
  replyTo?: string | null;
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
  return `<tr>
    <td style="padding:10px 0;${last ? "" : "border-bottom:1px solid #e4e9e5;"}color:#6d776f;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;">${escapeHtml(label)}</td>
    <td align="right" style="padding:10px 0;${last ? "" : "border-bottom:1px solid #e4e9e5;"}color:#17221c;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:1.4;">${escapeHtml(value)}</td>
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
  const companyName = params.company.name.trim() || "R. Hlavica s.r.o.";
  const logoUrl = safeLogoUrl(params.logoUrl);
  const replyAddress = safeReplyAddress(params.replyTo) ?? safeReplyAddress(params.company.email);
  const bankAccount = params.values.currency === "EUR"
    ? params.company.bank_account_eur?.trim()
    : params.company.bank_account_czk?.trim();
  const details = [
    ["Číslo faktury", params.values.invoice_number],
    ["Částka k úhradě", `${params.values.amount} ${params.values.currency}`],
    ["Datum splatnosti", params.values.due_date],
    ["Variabilní symbol", params.values.variable_symbol || "—"],
    ...(bankAccount ? [["Bankovní účet", bankAccount]] : []),
  ];
  const detailRows = details.map(([label, value], index) => detailRow(label, value, index === details.length - 1)).join("");
  const replyHref = replyAddress
    ? `mailto:${replyAddress}?subject=${encodeURIComponent(`Faktura ${params.values.invoice_number}`)}`
    : null;
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="91" height="85" alt="${escapeHtml(companyName)}" style="display:block;width:91px;height:85px;border:0;outline:none;text-decoration:none;object-fit:contain;">`
    : `<div style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;line-height:1.2;">R. Hlavica</div><div style="margin-top:4px;color:#a9cbb5;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;">DŘEVO &amp; LES</div>`;
  const cta = replyHref ? `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 24px;">
      <tr><td>
        <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${escapeHtml(replyHref)}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="12%" stroke="f" fillcolor="#17462f"><w:anchorlock xmlns:w="urn:schemas-microsoft-com:office:word"/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">Kontaktovat účetní oddělení</center></v:roundrect><![endif]-->
        <!--[if !mso]><!--><a href="${escapeHtml(replyHref)}" style="display:inline-block;padding:13px 20px;background:#17462f;border-radius:6px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:18px;text-decoration:none;">Kontaktovat účetní oddělení</a><!--<![endif]-->
      </td></tr>
    </table>` : "";
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
  <style>@media only screen and (max-width:620px){.email-shell{width:100%!important}.mobile-pad{padding-left:22px!important;padding-right:22px!important}.email-title{font-size:25px!important}.detail-box{padding:16px!important}}</style>
</head>
<body style="margin:0;padding:0;background:#f2f4f1;word-spacing:normal;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(presentation.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f2f4f1">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #dfe5e0;border-radius:12px;overflow:hidden;">
        <tr><td class="mobile-pad" bgcolor="#17462f" style="padding:18px 34px;background:#17462f;">${logo}</td></tr>
        <tr><td class="mobile-pad" style="padding:38px 42px 8px;">
          <div style="margin-bottom:10px;color:${presentation.accent};font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.3px;">${presentation.eyebrow}</div>
          <h1 class="email-title" style="margin:0 0 24px;color:#17221c;font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:700;line-height:1.2;letter-spacing:-0.5px;">${escapeHtml(presentation.title)}</h1>
          ${paragraphs(params.message)}
        </td></tr>
        <tr><td class="mobile-pad" style="padding:0 42px;">
          <table role="presentation" class="detail-box" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;padding:20px 22px;background:${presentation.soft};border:1px solid ${presentation.accent}33;border-radius:8px;">
            <tr><td colspan="2" style="padding:0 0 8px;color:${presentation.accent};font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.8px;">ÚDAJE K PLATBĚ</td></tr>
            ${detailRows}
          </table>
        </td></tr>
        <tr><td class="mobile-pad" style="padding:26px 42px 34px;">
          ${cta}
          <p style="margin:0;color:#35433a;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;">S pozdravem<br><strong>${escapeHtml(companyName)}</strong></p>
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
  const text = `${params.message.trim()}\n\nÚDAJE K PLATBĚ\n${textDetails}\n\nS pozdravem\n${companyName}${textContact ? `\n${textContact}` : ""}`;

  return { subject: params.subject, html, text };
}
