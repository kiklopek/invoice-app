"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { forgetNetworkInvitation, readNetworkInvitation, type RememberedNetworkInvitation } from "@/lib/network-invitation-memo";

// Pruh nad obsahem aplikace: uživatel přišel z pozvánky do sítě, mezitím se
// zaregistroval nebo přihlásil, a pozvánku ještě nepřijal.
export function NetworkInvitationResume() {
  const [pending, setPending] = useState<RememberedNetworkInvitation | null>(null);
  useEffect(() => {
    // Úložiště prohlížeče jde číst až po připojení na klientu.
    setPending(readNetworkInvitation());
  }, []);
  if (!pending) return null;
  return (
    <div className="network-resume-banner" role="status">
      <span>{pending.inviter ? `${pending.inviter} vás zve k propojení ve Splatno Síti.` : "Máte nevyřízenou pozvánku do Splatno Sítě."}</span>
      <div>
        <Link className="btn primary" href={`/pripojeni/${pending.token}`}>Zobrazit pozvánku</Link>
        <button type="button" className="btn secondary" onClick={() => { forgetNetworkInvitation(); setPending(null); }}>Zavřít</button>
      </div>
    </div>
  );
}
