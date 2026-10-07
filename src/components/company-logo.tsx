import Image from "next/image";

// Logo firmy, které člověk patří (R8). Logo bere z dat firmy
// (organizations.logo_path); firma bez loga dostane monogram z názvu.
// Konkrétní firma se tu nikdy nedosazuje natvrdo.

function monogram(name: string) {
  const words = name
    .replace(/\b(s\.?\s?r\.?\s?o\.?|a\.?\s?s\.?|spol\.?|v\.?\s?o\.?\s?s\.?)\b/gi, "")
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
  const letters = words.slice(0, 2).map((word) => [...word.replace(/[^\p{L}\p{N}]/gu, "")][0] ?? "");
  return letters.join("").toUpperCase() || "F";
}

export function CompanyLogo({
  src,
  name = "Firma",
  className = "",
}: {
  src: string | null | undefined;
  name?: string;
  className?: string;
}) {
  if (!src) {
    return (
      <span className={`company-monogram ${className}`} role="img" aria-label={`Firma ${name}`}>
        {monogram(name)}
      </span>
    );
  }
  return (
    <Image
      src={src}
      alt="Logo firmy"
      width={91}
      height={85}
      className={className}
      priority
    />
  );
}
