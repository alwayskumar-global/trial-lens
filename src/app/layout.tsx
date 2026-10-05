import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrialLens",
  description:
    "Screens public breast cancer trial criteria against information you provide. Does not determine eligibility.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
