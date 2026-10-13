// Pozvánka firmy, která Splatno ještě nepoužívá, do Splatno Sítě.
//
// Text je záměrně věcný a navázaný na existující obchodní vztah („firma X pro
// vás eviduje faktury“), bez pobídek a slev: zákon 480/2004 Sb. nezná pro B2B
// výjimku, a co by vypadalo jako reklama, je obchodní sdělení. Každá pozvánka
// nese informaci o zdroji adresy (čl. 14 GDPR) a odkaz na odhlášení, který
// platí pro všechny firmy ve Splatnu.
//
// Token, otisk a formát sdílí s pozvánkou do týmu (invitations.ts); platnost
// je delší, protože firma se rozhoduje pomaleji než kolega.

export { createInvitationToken as createNetworkInvitationToken, hashInvitationToken as hashNetworkInvitationToken, isInvitationToken as isNetworkInvitationToken } from "@/lib/invitations";

export const NETWORK_INVITATION_TTL_DAYS = 21;

export function networkInvitationExpiry(now = new Date()) {
  return new Date(now.getTime() + NETWORK_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function networkInvitationUrl(baseUrl: string, token: string) {
  return new URL(`/pripojeni/${token}`, baseUrl).toString();
}

export function networkInvitationOptOutUrl(baseUrl: string, token: string) {
  return new URL(`/pripojeni/${token}?odhlasit=1`, baseUrl).toString();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function invoicesPhrase(count: number) {
  if (count <= 0) return null;
  const noun = count === 1 ? "otevřenou fakturu" : count >= 2 && count <= 4 ? "otevřené faktury" : "otevřených faktur";
  return `${count} ${noun}`;
}

export function renderNetworkInvitationEmail(params: {
  inviterName: string;
  inviterIco: string;
  senderEmail: string;
  openCount: number;
  url: string;
  optOutUrl: string;
}) {
  const inviter = escapeHtml(params.inviterName);
  const sender = escapeHtml(params.senderEmail);
  const url = escapeHtml(params.url);
  const optOut = escapeHtml(params.optOutUrl);
  const invoices = invoicesPhrase(params.openCount);
  const invoiceLine = invoices ? `${params.inviterName} pro vás ve Splatnu eviduje ${invoices}. ` : "";
  const invoiceHtml = invoices ? `${inviter} pro vás ve Splatnu eviduje <b>${invoices}</b>. ` : "";
  const subject = `${params.inviterName} vás zve k propojení ve Splatnu`;
  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#13231b"><p style="font-size:22px;font-weight:700;margin:0 0 18px">splatno</p><h1 style="font-size:22px;margin:0 0 12px">${inviter} vás zve k propojení</h1><p>${invoiceHtml}Po propojení uvidíte faktury mezi vašimi firmami na jednom místě: co dlužíte vy, co dluží oni, splatnosti a stav plateb. K fakturám můžete rovnou připojit rozpor nebo oznámit platbu.</p><p style="margin:28px 0"><a href="${url}" style="display:inline-block;background:#245f42;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700">Zobrazit pozvánku</a></p><p style="color:#66736b;font-size:13px">Pozvánku odeslal(a) ${sender} z firmy ${inviter} (IČO ${escapeHtml(params.inviterIco)}). Vaši adresu Splatno převzalo z faktur, které vám tato firma vystavila; jinak ji nepoužíváme. Další pozvánky do Splatna si nepřejete? <a href="${optOut}" style="color:#66736b">Odhlásit se</a>.</p></div>`,
    text: `${subject}\n\n${invoiceLine}Po propojení uvidíte faktury mezi vašimi firmami na jednom místě: co dlužíte vy, co dluží oni, splatnosti a stav plateb.\n\nZobrazit pozvánku: ${params.url}\n\nPozvánku odeslal(a) ${params.senderEmail} z firmy ${params.inviterName} (IČO ${params.inviterIco}). Vaši adresu Splatno převzalo z faktur, které vám tato firma vystavila; jinak ji nepoužíváme.\nDalší pozvánky do Splatna si nepřejete? ${params.optOutUrl}`,
  };
}
