import type { Metadata } from "next";
import { Caveat, Great_Vibes, Nunito } from "next/font/google";
import { Suspense } from "react";
import Header from "@/components/brand/Header";
import SiteFooter from "@/components/brand/SiteFooter";
import SkipLink from "@/components/brand/SkipLink";
import HeaderAuth from "@/components/HeaderAuth";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  display: "swap",
});

// Elegant calligraphy for the wordmark and recipe titles only.
const greatVibes = Great_Vibes({
  variable: "--font-great-vibes",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

// Handwritten accent for small notes and taglines.
const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "ShefMeetsChef", template: "%s | ShefMeetsChef" },
  description: "Indian, fusion and everyday recipes from Shef, a home cook in New Zealand.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-NZ">
      <body className={`${nunito.variable} ${greatVibes.variable} ${caveat.variable} flex min-h-dvh flex-col font-sans antialiased`}>
        <SkipLink />
        <Header>
          <Suspense fallback={null}>
            <HeaderAuth />
          </Suspense>
        </Header>
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
