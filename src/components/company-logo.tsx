import Image from "next/image";

// Alt text je obecný záměrně: konkrétní jméno firmy patří do dat, ne do
// komponenty. Samotný soubor loga je zatím jeden (nasazení pro jednu firmu),
// ale text už se s ním nemusí měnit.
export function CompanyLogo({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/brand/drevohlavica.png"
      alt="Logo firmy"
      width={91}
      height={85}
      className={className}
      priority
    />
  );
}
