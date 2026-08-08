import Image from "next/image";

export function CompanyLogo({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/brand/drevohlavica.png"
      alt="R. Hlavica — dřevo & les"
      width={91}
      height={85}
      className={className}
      priority
    />
  );
}
