import "./globals.css";
import "./minimal.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Fakturační přehled",
  description: "Interní aplikace pro hlídání splatnosti faktur",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
