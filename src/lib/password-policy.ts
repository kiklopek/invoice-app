export function passwordProblem(password: string) {
  if (password.length < 12) return "Heslo musí mít alespoň 12 znaků.";
  if (!/[a-zá-ž]/.test(password)) return "Heslo musí obsahovat malé písmeno.";
  if (!/[A-ZÁ-Ž]/.test(password)) return "Heslo musí obsahovat velké písmeno.";
  if (!/\d/.test(password)) return "Heslo musí obsahovat číslo.";
  return null;
}
