export type PasswordRule = "length" | "lower" | "upper" | "digit";

const PASSWORD_MESSAGES: Record<PasswordRule, string> = {
  length: "Heslo musí mít alespoň 12 znaků.",
  lower: "Heslo musí obsahovat malé písmeno.",
  upper: "Heslo musí obsahovat velké písmeno.",
  digit: "Heslo musí obsahovat číslo.",
};

/** První nesplněné pravidlo hesla; formuláře podle něj ukážou hlášku ve svém jazyce. */
export function passwordRule(password: string): PasswordRule | null {
  if (password.length < 12) return "length";
  if (!/[a-zá-ž]/.test(password)) return "lower";
  if (!/[A-ZÁ-Ž]/.test(password)) return "upper";
  if (!/\d/.test(password)) return "digit";
  return null;
}

export function passwordProblem(password: string) {
  const rule = passwordRule(password);
  return rule ? PASSWORD_MESSAGES[rule] : null;
}
