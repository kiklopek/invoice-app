import "./globals.css";
import "./minimal.css";
import "./styles/responsive.css";
import "./styles/invoice-cards.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { privateRobots, siteOrigin } from "@/lib/seo";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f7f3",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  // Public product pages explicitly opt in; new application routes stay private.
  robots: privateRobots,
  applicationName: "Splatno",
  title: "Splatno | Faktury a upomínky pod kontrolou",
  description: "Přehled faktur, hlídání splatnosti a automatické upomínky.",
  // iOS Safari jinak sám dělá z e-mailů, telefonů a adres podtržené odkazy
  // (archiv faktur tak podtrhával e-mail odběratele místo jeho jména).
  formatDetection: { email: false, telephone: false, address: false },
  openGraph: {
    siteName: "Splatno",
    title: "Splatno | Faktury a upomínky pod kontrolou",
    description: "Přehled faktur, hlídání splatnosti a automatické upomínky.",
    locale: "cs_CZ",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
