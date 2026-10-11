// Upozornění administrátorům firmy, že do ní vstoupila podpora Splatna.
// Support je bez souhlasu, ale nikdy potichu: kdo, proč a do kdy.

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" }).format(new Date(iso));

export function renderSupportNotice(params: { companyName: string; operatorEmail: string; reason: string; expiresAt: string; settingsUrl: string }) {
  const until = formatTime(params.expiresAt);
  const subject = `Podpora Splatna vstoupila do firmy ${params.companyName}`;
  const text = [
    "Dobrý den,",
    "",
    `podpora Splatna (${params.operatorEmail}) právě vstoupila do vaší firmy ${params.companyName} jako administrátor, aby pomohla s tímto:`,
    params.reason,
    "",
    `Přístup skončí nejpozději ${until}. Kdykoli ho můžete ukončit v Nastavení → Tým: ${params.settingsUrl}`,
    "",
    "Splatno",
  ].join("\n");
  const html = `<p>Dobrý den,</p>
<p>podpora Splatna (<strong>${escapeHtml(params.operatorEmail)}</strong>) právě vstoupila do vaší firmy <strong>${escapeHtml(params.companyName)}</strong> jako administrátor, aby pomohla s tímto:</p>
<blockquote>${escapeHtml(params.reason)}</blockquote>
<p>Přístup skončí nejpozději <strong>${escapeHtml(until)}</strong>. Kdykoli ho můžete ukončit v <a href="${escapeHtml(params.settingsUrl)}">Nastavení → Tým</a>.</p>
<p>Splatno</p>`;
  return { subject, text, html };
}
