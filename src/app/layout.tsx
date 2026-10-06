import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fonts per the design handoff: Fraunces (display 500/600), Figtree (UI 400/500/600), IBM Plex Mono (400).
// Self-hosted from src/app/fonts (see README there): no build-time download, no request to Google from visitors' browsers.
const display = localFont({ src: [{ path: "./fonts/fraunces-latin-variable.woff2", weight: "500 600", style: "normal" }], variable: "--font-fraunces", display: "swap" });
const sans = localFont({ src: [{ path: "./fonts/figtree-latin-variable.woff2", weight: "400 600", style: "normal" }], variable: "--font-figtree", display: "swap" });
const mono = localFont({ src: [{ path: "./fonts/ibm-plex-mono-400-latin.woff2", weight: "400", style: "normal" }], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "TrialLens",
  description: "A map, not a verdict. This demo compares public breast cancer trial criteria with a fictional profile. Only a study team can confirm eligibility.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="tl-root">{children}</body>
    </html>
  );
}
