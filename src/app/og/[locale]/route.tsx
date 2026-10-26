import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getDictionary } from "@/i18n/dictionaries";
import { RibbonMark } from "@/components/landing/landing-icons";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ locale: "cs" }, { locale: "en" }];
}

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== "cs" && locale !== "en") return new Response(null, { status: 404 });
  const { landing } = getDictionary(locale);
  const font = await readFile(join(process.cwd(), "assets/fonts/LiberationSans-Bold.ttf"));

  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "64px 80px", background: "#f6f7f3", color: "#193d2a", fontFamily: "Liberation Sans", fontWeight: 700 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 44 }}>
        <RibbonMark size={56} />
        <span>splatno</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 62, fontSize: 86, lineHeight: 1.05 }}>
        <span>{landing.hero.titleLine1}</span>
        <span>{landing.hero.titleLine2}</span>
      </div>
      <div style={{ display: "flex", marginTop: 30, fontSize: 32 }}>{landing.hero.lead}</div>
      <div style={{ display: "flex", marginTop: "auto", fontSize: 24, color: "#47765b" }}>splatno.com</div>
    </div>,
    {
      width: 1200, height: 630,
      fonts: [{ name: "Liberation Sans", data: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) as ArrayBuffer, weight: 700, style: "normal" }],
    },
  );
}
