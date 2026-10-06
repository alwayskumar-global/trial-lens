import type { Metadata, Viewport } from "next";
import { Figtree, Fraunces, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Fonts per the design handoff: Fraunces (display 500/600), Figtree (UI 400/500/600), IBM Plex Mono (400).
// next/font self-hosts them at build time, so visitors' browsers make no request to Google.
const display = Fraunces({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-fraunces", display: "swap" });
const sans = Figtree({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-figtree", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "TrialLens",
  description: "A map, not a verdict. Compares public breast cancer trial criteria with what you tell us. Only a study team can confirm eligibility.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="tl-root">{children}</body>
    </html>
  );
}
