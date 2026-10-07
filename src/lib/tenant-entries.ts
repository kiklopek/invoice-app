// Firemní vstupy na splatno.cz/<firma>. Jediné místo v kódu, kde smí být
// konkrétní zákazník jménem: vstup je pro něj záměrně udělaný. Všude jinde
// se jméno, logo a doména firmy berou z dat (organizations).
export const HLAVICA_ENTRY = {
  path: "/hlavica",
  name: "R. Hlavica",
  logo: "/brand/drevohlavica.png",
  emailDomain: "hlavica.cz",
} as const;
