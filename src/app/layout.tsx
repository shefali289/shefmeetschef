import type { Metadata } from "next";
import { Inter, Pacifico } from "next/font/google";
import { Suspense } from "react";
import Header from "@/components/brand/Header";
import SkipLink from "@/components/brand/SkipLink";
import HeaderAuth from "@/components/HeaderAuth";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Script font for recipe titles only.
const pacifico = Pacifico({
  variable: "--font-pacifico",
  weight: "400",
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
      <body className={`${inter.variable} ${pacifico.variable} font-sans antialiased`}>
        <SkipLink />
        <Header>
          <Suspense fallback={null}>
            <HeaderAuth />
          </Suspense>
        </Header>
        {children}
      </body>
    </html>
  );
}
