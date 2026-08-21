export function displayName(fullName: unknown, email: string) {
  if (typeof fullName === "string") {
    const normalized = fullName.trim().replace(/\s+/g, " ").slice(0, 100);
    if (normalized) return normalized;
  }

  const localPart = email.split("@")[0] || "uživatel";
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toLocaleUpperCase("cs-CZ")}${part.slice(1)}`)
    .join(" ") || "Uživatel";
}

export function profileInitials(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const firstCharacter = (value: string) => Array.from(value)[0] ?? "";
  const value = parts.length > 1
    ? `${firstCharacter(parts[0])}${firstCharacter(parts[parts.length - 1])}`
    : Array.from(parts[0] || email).slice(0, 2).join("");
  return (value || "U").toLocaleUpperCase("cs-CZ");
}
