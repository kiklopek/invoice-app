// Product brand mark (Splatno) — kept separate from CompanyLogo, which shows
// the client's own business logo. See docs/brand/README.md.
//
// A plain <img>, not next/image: next.config.js doesn't set
// images.dangerouslyAllowSVG, so the image optimizer refuses local SVGs
// (400 at /_next/image) — and an already-vector icon this small gets no
// benefit from raster optimization anyway.
export function SplatnoMark({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/splatno-mark.svg"
      alt="Splatno"
      width={40}
      height={40}
      className={`splatno-mark ${className}`.trim()}
    />
  );
}
