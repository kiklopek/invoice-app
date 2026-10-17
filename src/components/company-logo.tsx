"use client";

import Image from "next/image";
import { useState } from "react";
import { DEFAULT_COMPANY_LOGO } from "@/lib/company-branding";

// Logo firmy, které člověk patří (R8). Logo bere z dat firmy
// (organizations.logo_path), společné pro administrátora i pozvané členy.
// Bez vlastního nebo dostupného loga se zobrazí značka Splatno.

export function CompanyLogo({
  src,
  name = "Firma",
  className = "",
}: {
  src: string | null | undefined;
  name?: string;
  className?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const companySource = src?.trim() || null;
  const imageSource = companySource && companySource !== failedSource ? companySource : DEFAULT_COMPANY_LOGO;
  const usesCompanyLogo = imageSource !== DEFAULT_COMPANY_LOGO;
  return (
    <Image
      src={imageSource}
      // Nahrané logo (/logo/<firma>?v=…) se vydává už hotové; optimalizace
      // obrázků by kvůli parametru verze vyžadovala zvláštní povolení.
      unoptimized={imageSource.startsWith("/logo/") || imageSource === DEFAULT_COMPANY_LOGO}
      alt={usesCompanyLogo ? `Logo firmy ${name}` : "Splatno"}
      width={91}
      height={85}
      className={className}
      preload
      onError={usesCompanyLogo ? () => setFailedSource(companySource) : undefined}
    />
  );
}
