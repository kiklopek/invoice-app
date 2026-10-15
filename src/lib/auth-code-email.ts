import { isVerificationCode } from "@/lib/verification-code";

type AuthCodeEmail = {
  code: string;
  purpose: "login" | "registration";
  locale?: "cs" | "en";
  inlineLogo?: boolean;
};

// Tables and inline styles keep the layout usable in Gmail and Outlook.
// No verification URLs: the recipient always enters the code in the app.
export function renderAuthCodeEmail({ code, purpose, locale = "cs", inlineLogo = false }: AuthCodeEmail) {
  if (!isVerificationCode(code)) throw new Error("INVALID_AUTH_EMAIL_CODE");
  const en = locale === "en";
  const registration = purpose === "registration";
  const logoSrc = inlineLogo ? "cid:splatno-auth-mark" : "https://www.splatno.cz/brand/splatno-auth-mark.png";
  const title = registration
    ? en ? "Verify your email" : "Ověřte svůj e-mail"
    : en ? "Verify your sign-in" : "Ověřte své přihlášení";
  const subject = registration
    ? en ? "Your Splatno verification code" : "Ověřovací kód Splatno"
    : en ? "Your Splatno sign-in code" : "Přihlašovací kód Splatno.cz";
  const intro = registration
    ? en ? "Welcome to Splatno. Enter this code on the registration page to confirm your email and complete your first sign-in." : "Vítejte ve Splatnu. Zadejte tento kód na stránce registrace. Potvrdíte tím e-mail a dokončíte první přihlášení."
    : en ? "Enter this code in Splatno to securely complete your sign-in." : "Pro bezpečné dokončení přihlášení zadejte tento kód v aplikaci Splatno.";
  const label = en ? "YOUR ONE-TIME CODE" : "VÁŠ JEDNORÁZOVÝ KÓD";
  const validity = en ? "Valid for 10 minutes. Can only be used once." : "Platí 10 minut. Lze použít pouze jednou.";
  const securityTitle = en ? "Keep your code to yourself" : "Kód patří jen vám";
  const security = en
    ? "Never share this code. Splatno support will never ask for it."
    : "Kód nikomu nesdělujte. Ani podpora Splatna ho po vás nikdy nebude chtít.";
  const ignore = registration
    ? en ? "Didn't create an account? You can safely ignore this email." : "Účet jste si nezakládali? Tento e-mail můžete bezpečně ignorovat."
    : en ? "Didn't try to sign in? You can safely ignore this email." : "Nepřihlašovali jste se? Tento e-mail můžete bezpečně ignorovat.";
  const tagline = en ? "Invoices under control." : "Faktury pod kontrolou.";
  const preheader = en ? "Your one-time code to continue securely in Splatno." : "Váš jednorázový kód pro bezpečné pokračování ve Splatnu.";
  const html = `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${subject}</title>
<style>@media only screen and (max-width:600px){.outer{padding:24px 12px!important}.content{padding:28px 22px!important}.code{font-size:30px!important;letter-spacing:4px!important}.heading{font-size:26px!important}}</style></head>
<body style="margin:0;padding:0;background-color:#f2f6f3;color:#15291f;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
<div style="display:none;font-size:1px;line-height:1px;color:#f2f6f3;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f6f3"><tr><td align="center" class="outer" style="padding:48px 20px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px">
<tr><td style="padding:0 8px 26px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="38" style="vertical-align:middle"><img src="${logoSrc}" alt="" width="24" height="32" style="display:block;border:0;width:24px;height:32px"></td><td style="font-size:29px;line-height:34px;font-weight:700;letter-spacing:-1px;color:#17573d">splatno</td></tr></table></td></tr>
<tr><td style="background-color:#ffffff;border:1px solid #dfe9e2;border-radius:20px;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="height:6px;background-color:#1b6446;border-radius:20px 20px 0 0;font-size:1px;line-height:6px">&nbsp;</td></tr>
<tr><td class="content" style="padding:38px 38px 34px">
<p style="margin:0 0 14px;color:#287052;font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.5px">${en ? "SECURE ACCESS" : "BEZPEČNÝ PŘÍSTUP"}</p>
<h1 class="heading" style="margin:0 0 16px;font-size:30px;line-height:1.2;letter-spacing:-.7px;font-weight:700;color:#15291f">${title}</h1>
<p style="margin:0 0 28px;color:#64746b;font-size:16px;line-height:26px">${intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eaf4ed;border:1px solid #d5e7db;border-radius:14px"><tr><td align="center" style="padding:23px 12px 24px">
<p style="margin:0 0 12px;color:#507460;font-size:10px;line-height:16px;font-weight:700;letter-spacing:1.4px">${label}</p>
<p class="code" dir="ltr" style="margin:0;color:#17573d;font-family:'Courier New',Courier,monospace;font-size:38px;line-height:48px;font-weight:700;letter-spacing:7px;white-space:nowrap">${code}</p>
</td></tr></table>
<p style="margin:14px 0 28px;color:#738178;font-size:12px;line-height:20px;text-align:center">${validity}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e8eeea"><tr><td style="padding-top:24px">
<p style="margin:0 0 6px;color:#314e3d;font-size:13px;line-height:20px;font-weight:700">${securityTitle}</p>
<p style="margin:0;color:#738178;font-size:12px;line-height:20px">${security}</p>
</td></tr></table>
</td></tr></table></td></tr>
<tr><td align="center" style="padding:24px 18px 0"><p style="margin:0 0 12px;color:#7c8980;font-size:12px;line-height:20px">${ignore}</p><p style="margin:0;color:#51715e;font-size:12px;line-height:20px"><strong>Splatno</strong> &nbsp;·&nbsp; ${tagline}</p></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text: `${title}\n\n${intro}\n\n${label}: ${code}\n\n${validity}\n\n${securityTitle}\n${security}\n\n${ignore}\n\nSplatno · ${tagline}` };
}
