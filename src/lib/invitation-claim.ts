// Kdy smí přihlášený účet převzít čekající členství (pozvánku) jen podle
// e-mailu. Token z pozvánky tu není: pozvaný se může registrovat i obecnou
// registrací a firma se vstupem (R. Hlavica) pozvánky e-mailem neposílá.
// Vlastnictví adresy proto musí být prokázané potvrzením e-mailu -- jinak by
// se k firmě připojil kdokoli, kdo si pozvanou adresu zaregistruje.
export function canClaimInvitation(
  user: { email_confirmed_at?: string | null },
  invitation: { invite_expires_at: string | null },
  now: Date = new Date(),
) {
  if (!user.email_confirmed_at) return false;
  if (invitation.invite_expires_at && new Date(invitation.invite_expires_at) <= now) return false;
  return true;
}
